// 하루 1회 Discord 요약 전송 스크립트
// - 최근 24시간 안에 수집된 기사를 분야별로 정리
// - EXAONE_API_KEY가 있으면 LG 엑사온(EXAONE) 2.5 API로 분야별 짧은 요약을 붙임 (권장)
// - EXAONE_API_KEY가 없고 ANTHROPIC_API_KEY + ANTHROPIC_MODEL이 둘 다 설정돼 있으면 Claude로 폴백
//   (둘 다 없으면 요약 없이 헤드라인 목록만 보냄 — 조용히 실패하지 않고 로그로 알림)
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
// 1순위: LG 엑사온(EXAONE). OpenAI 호환 chat/completions 형식
const EXAONE_API_KEY = process.env.EXAONE_API_KEY;
const EXAONE_MODEL = process.env.EXAONE_MODEL || "k-exaone_v2.5"; // 바꾸려면 Variables의 EXAONE_MODEL로 덮어쓰기
const EXAONE_ENDPOINT = "https://api.exaone.ai/v1/chat/completions";
// 2순위: Claude (엑사온 키가 없을 때만)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL; // 예: console.anthropic.com에서 확인한 현재 모델 이름
const DIGEST_HOURS = Number(process.env.DIGEST_HOURS || 24);
const MAX_ITEMS_PER_CATEGORY = 8;
// 요약 프롬프트에는 상위 이 정도만 넣음. 기사가 수백 건인 분야는 헤드라인을 전부 넣으면
// 프롬프트가 너무 길어져 추론만 하다가 max_tokens를 다 쓰고 빈 답이 돌아옴(엑사온 2.5에서 확인).
const MAX_ITEMS_FOR_SUMMARY = 15;
// 엑사온 무료 티어는 초당 1회 제한 → 호출 사이 간격을 둠
const EXAONE_MIN_INTERVAL_MS = 1200;
// 요약 API가 응답 없이 매달려 Actions 작업이 끝나지 않는 것을 막음
// (엑사온 2.5는 추론 모델이라 분야 하나에 30~60초 걸릴 때가 있음)
const AI_TIMEOUT_MS = 90_000;
const DISCORD_TIMEOUT_MS = 15_000;

const CATEGORY_COLORS = {
  ai: 0x6366f1,
  it: 0x0ea5e9,
  economy: 0x22c55e,
};

async function loadJson(p) {
  const raw = await readFile(p, "utf-8");
  return JSON.parse(raw);
}

function buildPrompt(categoryLabel, items) {
  const bulletList = items
    .slice(0, MAX_ITEMS_FOR_SUMMARY)
    .map((i) => `- ${i.title} (${i.source})`)
    .join("\n");

  // 엑사온 2.5는 추론 토큰도 max_tokens에 포함되므로, "추론 길게 쓰지 말고 요약만"을
  // 안 적으면 추론만 하다가 토큰을 다 쓰고 빈 답(content:"")이 올 수 있음
  return `다음은 "${categoryLabel}" 분야 오늘자 뉴스 헤드라인 목록이야. 과장하지 말고 사실 위주로 2~3문장 한국어 요약을 만들어줘. 헤드라인 나열 말고 흐름 위주로. 머리말·설명·추론 과정 없이 요약문만 바로 출력해.\n\n${bulletList}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lastExaoneCallAt = 0;
async function throttleExaone() {
  const wait = lastExaoneCallAt + EXAONE_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastExaoneCallAt = Date.now();
}

// LG 엑사온 2.5 요약 — 추론 과정은 reasoning_content로 오고, 최종 답은 message.content에 담김
async function summarizeWithExaone(categoryLabel, items) {
  if (!EXAONE_API_KEY) return null;

  const body = {
    model: EXAONE_MODEL,
    messages: [{ role: "user", content: buildPrompt(categoryLabel, items) }],
    reasoning_effort: "low",
    // 엑사온 2.5는 추론 토큰도 max_tokens에 포함됨. 1000으로 두면 추론만 하다가 토큰을 다 써서
    // content가 빈 문자열로 오는 경우가 절반 가까이 나와서(실측) 2000으로 잡음.
    max_tokens: 2000,
  };

  // 429(초당 호출 제한)와 빈 응답은 한 번 더 시도
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await throttleExaone();
      const res = await fetch(EXAONE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${EXAONE_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      if (!res.ok) {
        const text = await res.text();
        console.warn(
          `[엑사온 요약 실패] ${categoryLabel} (${attempt}/${MAX_ATTEMPTS}): ${res.status} ${text}`
        );
        if (res.status === 429 && attempt < MAX_ATTEMPTS) {
          await sleep(2000);
          continue;
        }
        return null;
      }
      const data = await res.json();
      const choice = data?.choices?.[0];
      const text = choice?.message?.content?.trim();
      if (text) {
        // max_tokens에 걸려 문장이 중간에 잘렸으면 한 번 더 시도
        if (choice?.finish_reason === "length" && attempt < MAX_ATTEMPTS) {
          console.warn(
            `[엑사온 요약 재시도] ${categoryLabel}: 응답이 max_tokens에서 잘렸습니다(finish_reason=length).`
          );
          await sleep(1000);
          continue;
        }
        if (choice?.finish_reason === "length") {
          console.warn(
            `[엑사온 요약 경고] ${categoryLabel}: 응답이 잘린 상태로 전송합니다.`
          );
        }
        return text;
      }
      // 추론만 하고 content가 비어 오는 경우 — 헤드라인 목록만 보내도록 null 반환
      console.warn(
        `[엑사온 요약 실패] ${categoryLabel} (${attempt}/${MAX_ATTEMPTS}): 빈 응답(content 없음, finish_reason=${choice?.finish_reason})`
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000);
        continue;
      }
      return null;
    } catch (err) {
      console.warn(
        `[엑사온 요약 실패] ${categoryLabel} (${attempt}/${MAX_ATTEMPTS}):`,
        err
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000);
        continue;
      }
      return null;
    }
  }
  return null;
}

async function summarizeWithClaude(categoryLabel, items) {
  if (!ANTHROPIC_API_KEY || !ANTHROPIC_MODEL) return null;

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 300,
    messages: [{ role: "user", content: buildPrompt(categoryLabel, items) }],
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
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
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

// 엑사온 우선, 실패하거나 키가 없으면 Claude, 그것도 안 되면 요약 없이
async function summarize(categoryLabel, items) {
  if (EXAONE_API_KEY) {
    const text = await summarizeWithExaone(categoryLabel, items);
    if (text) return text;
    if (!ANTHROPIC_API_KEY || !ANTHROPIC_MODEL) return null;
    console.log(`[요약 폴백] ${categoryLabel}: 엑사온 요약이 비어 Claude로 재시도합니다.`);
  }
  return summarizeWithClaude(categoryLabel, items);
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

function usingClaude() {
  return Boolean(ANTHROPIC_API_KEY && ANTHROPIC_MODEL);
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error(
      "DISCORD_WEBHOOK_URL이 설정되지 않았습니다. GitHub Secrets를 확인하세요."
    );
    process.exit(1);
  }
  if (EXAONE_API_KEY) {
    console.log(`LG 엑사온(${EXAONE_MODEL})으로 AI 요약을 만듭니다.`);
    if (usingClaude()) {
      console.log("ANTHROPIC_API_KEY도 설정돼 있어, 엑사온 요약이 비면 Claude로 폴백합니다.");
    }
  } else if (usingClaude()) {
    console.log(
      `EXAONE_API_KEY가 없어 Claude(${ANTHROPIC_MODEL})로 AI 요약을 만듭니다.`
    );
  } else {
    console.log(
      "EXAONE_API_KEY / ANTHROPIC_API_KEY가 없어 AI 요약 없이 헤드라인만 전송합니다."
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
    const summary = await summarize(def.label, items);
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
    signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
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
