import { DAILY_COLUMN_INDEX_ROUTE } from "@/lib/daily-column/routes";

export const LEGACY_RSS_FEEDS = [
  {
    slug: "today",
    apiPath: "/api/rss/today.xml",
    route: "/zh",
    channelTitle: "AX Radar — 热点聚合",
    channelDescription: "今日 AI 行业要闻，自动聚合多源覆盖。",
    integrationTitle: {
      zh: "AX Radar — 热点聚合",
      en: "AX Radar — hot today",
    },
    integrationDescription: {
      zh: "今日 AI 行业要闻,自动聚合多源覆盖。",
      en: "Today's AI news and multi-source events.",
    },
    recommended: true,
  },
  {
    slug: "curated",
    apiPath: "/api/rss/curated.xml",
    route: "/zh/curated",
    channelTitle: "AX Radar — AX 严选",
    channelDescription: "操作员手选信源，鸭哥/grapeot, AI 群聊日报, 阮一峰等。",
    integrationTitle: {
      zh: "AX Radar — AX 严选",
      en: "AX Radar — curated",
    },
    integrationDescription: {
      zh: "操作员手选信源:鸭哥/grapeot、AI 群聊日报、阮一峰等。",
      en: "Operator-curated publishers — Grapeot, AI 群聊日报, Ruanyifeng, etc.",
    },
    recommended: false,
  },
  {
    slug: "daily",
    apiPath: "/api/rss/daily.xml",
    route: DAILY_COLUMN_INDEX_ROUTE,
    channelTitle: "AX Radar — 每日 AI 日报",
    channelDescription:
      "每日 9pm PT 一篇 AI 日报，2500-4500 字编辑视角，作者主笔。",
    integrationTitle: {
      zh: "AX Radar — 每日 AI 日报",
      en: "AX Radar — daily column",
    },
    integrationDescription: {
      zh: "每日 9pm PT 一篇 AI 日报,像朋友分享一样讲清楚当天重点。",
      en: "Daily 9pm PT — a clear editorial column that reads like sharing the day's signal with a friend.",
    },
    recommended: false,
  },
] as const;

export type LegacyRssFeed = (typeof LEGACY_RSS_FEEDS)[number];
export type LegacyRssSlug = LegacyRssFeed["slug"];
export type LegacyLaneRssSlug = Exclude<LegacyRssSlug, "daily">;

const LEGACY_RSS_SLUGS = LEGACY_RSS_FEEDS.map(
  (feed) => feed.slug,
) as readonly LegacyRssSlug[];

const LEGACY_RSS_FEED_BY_SLUG = new Map<LegacyRssSlug, LegacyRssFeed>(
  LEGACY_RSS_FEEDS.map((feed) => [feed.slug, feed]),
);

export function legacyRssFeedMeta(slug: LegacyRssSlug): LegacyRssFeed {
  const meta = LEGACY_RSS_FEED_BY_SLUG.get(slug);
  if (!meta) {
    throw new Error(`unknown legacy RSS slug: ${slug}`);
  }
  return meta;
}

export function parseLegacyRssSlug(rawSlug: string): LegacyRssSlug | null {
  const slug = rawSlug.replace(/\.xml$/, "");
  return (LEGACY_RSS_SLUGS as readonly string[]).includes(slug)
    ? (slug as LegacyRssSlug)
    : null;
}
