export type NewsItem = {
  id: string;
  category: string;
  source: string;
  title: string;
  link: string;
  summary: string;
  pubDate: string; // ISO
  collectedAt: string; // ISO
};

export type FeedsConfig = Record<
  string,
  {
    label: string;
    sources: { name: string; url: string }[];
  }
>;
