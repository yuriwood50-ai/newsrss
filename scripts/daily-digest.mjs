// 하루 1회 Discord 요약 전송 스크립트
// - 최근 24시간 안에 수집된 기사를 분야별로 정리
// - ANTHROPIC_API_KEY + ANTHROPIC_MODEL이 둘 다 설정돼 있으면 분야별 짧은 요약을 붙임
//   (둘 중 하나라도 없으면 요약 없이 헤드라인 목록만 보냄 — 조용히 실패하지 않고 로그로 알림)
// - DISCORD_WEBHOOK_URL로 Embed 형태 전송
//
// 실행: node scripts/daily-digest.mjs
// GitHub Actions에서 하루 1회 자동 실행됨 (.github/workflows/daily-digest.yml)

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const NEWS_PATH = path.join(ROOT, "data", "news.json");
const FEEDS_PATH = path.join(ROOT, "feeds.json");

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL; // 예: console.anthropic.com에서 확인한 현재 모델 이름
const DIGEST_HOURS = Number(process.env.DIGEST_HOURS || 24);
const MAX_ITEMS_PER_CATEGORY = 8;

const CATEGORY_COLORS = {
  ai: 0x6366f1,
  it: 0x0ea5e9,
  economy: 0x22c55e,
};

async function loadJson(p) {
  const raw = await readFile(p, "utf-8");
  return JSON.parse(raw);
}

async function summarizeWithClaude(categoryLabel, items) {
  if (!ANTHROPIC_API_KEY || !ANTHROPIC_MODEL) return null;

  const bulletList = items
    .map((i) => `- ${i.title} (${i.source})`)
    .join("\n");

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `다음은 "${categoryLabel}" 분야 오늘자 뉴스 헤드라인 목록이야. 과장하지 말고 사실 위주로 2~3문장 한국어 요약을 만들어줘. 헤드라인 나열 말고 흐름 위주로.\n\n${bulletList}`,
      },
    ],
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[요약 실패] ${categoryLabel}: ${res.status} ${text}`);
      return null;
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text?.trim();
    return text || null;
  } catch (err) {
    console.warn(`[요약 실패] ${categoryLabel}:`, err);
    return null;
  }
}

function buildEmbed(categoryKey, categoryLabel, items, summary) {
  const lines = items
    .slice(0, MAX_ITEMS_PER_CATEGORY)
    .map((i) => `• [${i.title}](${i.link}) — ${i.source}`)
    .join("\n");

  const descriptionParts = [];
  if (summary) descriptionParts.push(summary);
  descriptionParts.push(lines || "오늘 수집된 기사가 없습니다.");

  return {
    title: `${categoryLabel} (${items.length}건)`,
    description: descriptionParts.join("\n\n").slice(0, 4000),
    color: CATEGORY_COLORS[categoryKey] ?? 0x888888,
  };
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error(
      "DISCORD_WEBHOOK_URL이 설정되지 않았습니다. GitHub Secrets를 확인하세요."
    );
    process.exit(1);
  }
  if (!ANTHROPIC_API_KEY || !ANTHROPIC_MODEL) {
    console.log(
      "ANTHROPIC_API_KEY 또는 ANTHROPIC_MODEL이 없어 AI 요약 없이 헤드라인만 전송합니다."
    );
  }

  const [news, feedsConfig] = await Promise.all([
    loadJson(NEWS_PATH),
    loadJson(FEEDS_PATH),
  ]);

  const cutoff = Date.now() - DIGEST_HOURS * 60 * 60 * 1000;
  const recent = news.filter((n) => new Date(n.collectedAt).getTime() >= cutoff);

  const embeds = [];
  for (const [key, def] of Object.entries(feedsConfig)) {
    const items = recent
      .filter((n) => n.category === key)
      .sort(
        (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
      );
    if (items.length === 0) continue;
    const summary = await summarizeWithClaude(def.label, items);
    embeds.push(buildEmbed(key, def.label, items, summary));
  }

  if (embeds.length === 0) {
    console.log(`최근 ${DIGEST_HOURS}시간 내 수집된 기사가 없어 전송을 건너뜁니다.`);
    return;
  }

  const today = new Date().toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: `📰 ${today} 뉴스 요약`,
      embeds: embeds.slice(0, 10),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Discord 전송 실패: ${res.status} ${text}`);
    process.exit(1);
  }

  console.log(`Discord로 ${embeds.length}개 분야 요약 전송 완료`);
}

main().catch((err) => {
  console.error("일일 다이제스트 스크립트 실행 중 오류:", err);
  process.exit(1);
});
