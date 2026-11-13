// RSS 수집 스크립트
// - feeds.json에 정의된 분야별 소스를 전부 파싱
// - guid(없으면 link) 기준으로 이미 수집된 기사는 건너뜀
// - 결과를 data/news.json에 최신순으로 누적 저장 (오래된 건 자동 정리)
//
// 실행: node scripts/collect.mjs
// GitHub Actions에서 2시간마다 자동 실행됨 (.github/workflows/collect.yml)

import Parser from "rss-parser";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripHtml, itemId } from "../lib/text.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const FEEDS_PATH = path.join(ROOT, "feeds.json");
const NEWS_PATH = path.join(ROOT, "data", "news.json");

// 하나가 느리거나 죽어도 전체 수집이 멈추지 않도록 피드마다 타임아웃을 둠
const FETCH_TIMEOUT_MS = 15_000;
// news.json이 무한정 커지지 않도록 최근 며칠치만 유지
const KEEP_DAYS = 14;
// 혹시 몰라 절대 상한도 하나 둠
const MAX_ITEMS = 1500;

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (compatible; newsrss-collector/1.0; +https://github.com/)",
  },
});

async function loadFeedsConfig() {
  const raw = await readFile(FEEDS_PATH, "utf-8");
  return JSON.parse(raw);
}

async function loadExisting() {
  try {
    const raw = await readFile(NEWS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// 타임존 표기가 없는 KST 문자열("2026-11-10 18:14:53")은 new Date()가 실행 환경의
// 로컬 시간으로 해석함. GitHub Actions(UTC)에서는 이게 9시간 미래로 밀려서 기사가
// 영원히 "최신"으로 고정됨(AI타임스 피드가 이 형식). → KST 오프셋(+09:00)을 붙여 파싱.
const NAIVE_DATE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;

function parsePubDate(value) {
  if (!value) return new Date();
  const text = String(value).trim();
  const normalized = NAIVE_DATE_RE.test(text)
    ? `${text.replace(" ", "T")}+09:00`
    : text;
  const parsed = new Date(normalized);
  // 형식을 못 알아보면 수집 시각을 씀 (잘못된 날짜로 toISOString이 던지는 것 방지)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function fetchFeed(category, source) {
  try {
    const feed = await parser.parseURL(source.url);
    const items = (feed.items || []).map((raw) => {
      const link = raw.link || raw.guid || "";
      // rss-parser의 isoDate는 위 버그를 이미 안고 있으므로 원본 pubDate를 먼저 봄
      const pubDate = raw.pubDate || raw.isoDate || raw.dcDate;
      return {
        id: itemId(raw) || link,
        category,
        source: source.name,
        title: (raw.title || "(제목 없음)").trim(),
        link,
        summary: stripHtml(raw.contentSnippet || raw.content || raw.summary),
        pubDate: parsePubDate(pubDate).toISOString(),
      };
    });
    return { ok: true, source: source.name, count: items.length, items };
  } catch (err) {
    return {
      ok: false,
      source: source.name,
      url: source.url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const feedsConfig = await loadFeedsConfig();
  const existing = await loadExisting();

  const collected = [];
  const failures = [];

  for (const [category, def] of Object.entries(feedsConfig)) {
    for (const source of def.sources) {
      const result = await fetchFeed(category, source);
      if (!result.ok) {
        failures.push(result);
        console.warn(`[실패] ${category}/${result.source}: ${result.error}`);
        continue;
      }
      console.log(`[수집] ${category}/${result.source}: ${result.count}건`);
      collected.push(...result.items);
    }
  }

  const now = new Date().toISOString();
  let addedCount = 0;
  let correctedCount = 0;
  const byId = new Map(existing.map((i) => [i.id, i]));
  for (const item of collected) {
    const prev = byId.get(item.id);
    if (prev) {
      // 이미 저장된 기사라도 피드의 pubDate가 달라졌으면 고쳐둠.
      // (예전에 타임존 없는 날짜를 잘못 파싱해 미래로 저장된 기사가 그대로 굳는 것을 막음)
      if (prev.pubDate !== item.pubDate) {
        prev.pubDate = item.pubDate;
        correctedCount += 1;
      }
      continue;
    }
    const entry = { ...item, collectedAt: now };
    existing.push(entry);
    byId.set(entry.id, entry);
    addedCount += 1;
  }

  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let merged = existing.filter((i) => new Date(i.pubDate).getTime() >= cutoff);
  merged.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  if (merged.length > MAX_ITEMS) merged = merged.slice(0, MAX_ITEMS);

  await writeFile(NEWS_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");

  console.log(
    `완료: 새 기사 ${addedCount}건 추가, 시각 보정 ${correctedCount}건, 총 ${merged.length}건 보관 (실패한 소스 ${failures.length}개)`
  );

  // 전체 소스가 다 실패했을 때만 실패로 처리 (일부 실패는 정상 — RSS는 원래 가끔 죽음)
  if (failures.length > 0 && collected.length === 0) {
    console.error("모든 RSS 소스 수집에 실패했습니다.");
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("수집 스크립트 실행 중 오류:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    // rss-parser 내부 http 클라이언트가 소켓을 물고 있어서 프로세스가 안 끝나는
    // 경우가 있어 명시적으로 종료함 (GitHub Actions에서 잡이 안 끝나고 멈추는 것 방지)
    process.exit(process.exitCode ?? 0);
  });
