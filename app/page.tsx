import fs from "node:fs";
import path from "node:path";
import type { NewsItem, FeedsConfig } from "@/lib/types";
import { formatKst, relativeFromNow } from "@/lib/format";

function loadNews(): NewsItem[] {
  try {
    const file = path.join(process.cwd(), "data", "news.json");
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadFeedsConfig(): FeedsConfig {
  const file = path.join(process.cwd(), "feeds.json");
  const raw = fs.readFileSync(file, "utf-8");
  return JSON.parse(raw);
}

export default function Home() {
  const news = loadNews();
  const feedsConfig = loadFeedsConfig();
  const categories = Object.entries(feedsConfig);

  const lastCollectedAt = news.reduce<string | null>((latest, item) => {
    if (!latest || item.collectedAt > latest) return item.collectedAt;
    return latest;
  }, null);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-10 sm:px-8">
          <p className="text-sm font-medium tracking-wide text-neutral-400">
            NEWSRSS
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-neutral-900">
            분야별 뉴스 모음
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-neutral-500">
            AI · IT · 경제 분야 RSS를 2시간마다 자동 수집해서 최신순으로
            정리합니다.
            {lastCollectedAt && (
              <> 마지막 수집: {formatKst(lastCollectedAt)} (KST)</>
            )}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-16 px-6 py-12 sm:px-8">
        {categories.map(([key, def]) => {
          const items = news
            .filter((n) => n.category === key)
            .sort(
              (a, b) =>
                new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
            );

          return (
            <section key={key}>
              <div className="mb-6 flex items-baseline justify-between border-b border-neutral-200 pb-3">
                <h2 className="text-xl font-semibold text-neutral-900">
                  {def.label}
                </h2>
                <span className="text-sm text-neutral-400">
                  {items.length}건
                </span>
              </div>

              {items.length === 0 ? (
                <p className="py-10 text-center text-sm text-neutral-400">
                  아직 수집된 기사가 없습니다. 첫 자동 수집(2시간 주기) 이후
                  이곳에 표시됩니다.
                </p>
              ) : (
                <ul className="space-y-6">
                  {items.map((item) => (
                    <li key={item.id}>
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block rounded-xl border border-transparent px-4 py-4 -mx-4 transition hover:border-neutral-200 hover:bg-white"
                      >
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
                          <span className="font-medium text-neutral-500">
                            {item.source}
                          </span>
                          <span aria-hidden>·</span>
                          <span>{relativeFromNow(item.pubDate)}</span>
                        </div>
                        <h3 className="mt-2 text-base font-medium leading-snug text-neutral-900 group-hover:underline">
                          {item.title}
                        </h3>
                        {item.summary && (
                          <p className="mt-2 text-sm leading-relaxed text-neutral-500">
                            {item.summary}
                          </p>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </main>

      <footer className="border-t border-neutral-200 py-10 text-center text-xs text-neutral-400">
        GitHub Actions로 2시간마다 수집 · 매일 Discord로 요약 전송
      </footer>
    </div>
  );
}

export const dynamic = "force-static";
