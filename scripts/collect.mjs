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

async function fetchFeed(category, source) {
  try {
    const feed = await parser.parseURL(source.url);
    const items = (feed.items || []).map((raw) => {
      const link = raw.link || raw.guid || "";
      const pubDate = raw.isoDate || raw.pubDate || new Date().toISOString();
      return {
        id: itemId(raw) || link,
        category,
        source: source.name,
        title: (raw.title || "(제목 없음)").trim(),
        link,
        summary: stripHtml(raw.contentSnippet || raw.content || raw.summary),
        pubDate: new Date(pubDate).toISOString(),
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
  const existingIds = new Set(existing.map((i) => i.id));

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
  for (const item of collected) {
    if (existingIds.has(item.id)) continue;
    existingIds.add(item.id);
    existing.push({ ...item, collectedAt: now });
    addedCount += 1;
  }

  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let merged = existing.filter((i) => new Date(i.pubDate).getTime() >= cutoff);
  merged.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  if (merged.length > MAX_ITEMS) merged = merged.slice(0, MAX_ITEMS);

  await writeFile(NEWS_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");

  console.log(
    `완료: 새 기사 ${addedCount}건 추가, 총 ${merged.length}건 보관 (실패한 소스 ${failures.length}개)`
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
