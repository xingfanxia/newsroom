export const MAIN_RSS_FEEDS = [
  {
    locale: "zh",
    apiPath: "/api/feed/zh/rss.xml",
    route: "/zh",
    channelTitle: "AX 的 AI 雷达",
    channelDescription:
      "双语 AI 情报雷达 — 从已监控的精选信源目录中提炼每日高价值内容。",
    language: "zh-CN",
    alternateTitle: "AX 的 AI 雷达 (中文)",
    integrationTitle: {
      zh: "AX Radar — 双语主 feed (zh)",
      en: "AX Radar — main feed (zh)",
    },
    integrationDescription: {
      zh: "featured + p1 合集,带 锐评 + content:encoded 全文。",
      en: "Featured + p1 union with editor commentary in content:encoded.",
    },
  },
  {
    locale: "en",
    apiPath: "/api/feed/en/rss.xml",
    route: "/en",
    channelTitle: "AX's AI RADAR",
    channelDescription:
      "Bilingual AI intelligence radar — curated daily signal from the monitored source catalog.",
    language: "en-US",
    alternateTitle: "AX's AI RADAR (English)",
    integrationTitle: {
      zh: "AX Radar — 双语主 feed (en)",
      en: "AX Radar — main feed (en)",
    },
    integrationDescription: {
      zh: "英文版主 feed。",
      en: "English main feed (English titles + summaries).",
    },
  },
] as const;

export type MainRssFeed = (typeof MAIN_RSS_FEEDS)[number];
export type MainRssLocale = MainRssFeed["locale"];

const MAIN_RSS_FEED_BY_LOCALE = new Map<MainRssLocale, MainRssFeed>(
  MAIN_RSS_FEEDS.map((feed) => [feed.locale, feed]),
);

export function coerceMainRssLocale(value: string): MainRssLocale {
  return value === "en" ? "en" : "zh";
}

export function mainRssFeedMeta(locale: MainRssLocale): MainRssFeed {
  const meta = MAIN_RSS_FEED_BY_LOCALE.get(locale);
  if (!meta) {
    throw new Error(`unknown main RSS locale: ${locale}`);
  }
  return meta;
}
