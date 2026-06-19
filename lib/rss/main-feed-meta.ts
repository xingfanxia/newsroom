import {
  APP_LOCALES,
  appLocaleLanguageTag,
  type AppLocale,
} from "@/lib/types";

type LocalizedRssText = Record<AppLocale, string>;

export type MainRssLocale = AppLocale;

export type MainRssFeed = {
  locale: MainRssLocale;
  apiPath: `/api/feed/${MainRssLocale}/rss.xml`;
  route: `/${MainRssLocale}`;
  channelTitle: string;
  channelDescription: string;
  language: string;
  alternateTitle: string;
  integrationTitle: LocalizedRssText;
  integrationDescription: LocalizedRssText;
};

type MainRssFeedDefinition = Omit<MainRssFeed, "locale">;
type MainRssFeedDefinitionInput = Omit<MainRssFeedDefinition, "language">;

const MAIN_RSS_FEED_DEFINITIONS = {
  zh: {
    apiPath: "/api/feed/zh/rss.xml",
    route: "/zh",
    channelTitle: "AX 的 AI 雷达",
    channelDescription:
      "双语 AI 情报雷达 — 从已监控的精选信源目录中提炼每日高价值内容。",
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
  en: {
    apiPath: "/api/feed/en/rss.xml",
    route: "/en",
    channelTitle: "AX's AI RADAR",
    channelDescription:
      "Bilingual AI intelligence radar — curated daily signal from the monitored source catalog.",
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
} as const satisfies Record<AppLocale, MainRssFeedDefinitionInput>;

export const MAIN_RSS_FEEDS: readonly MainRssFeed[] = APP_LOCALES.map(
  (locale) => ({
    locale,
    language: appLocaleLanguageTag(locale),
    ...MAIN_RSS_FEED_DEFINITIONS[locale],
  }),
);

const MAIN_RSS_FEED_BY_LOCALE = new Map<MainRssLocale, MainRssFeed>(
  MAIN_RSS_FEEDS.map((feed) => [feed.locale, feed] as const),
);

const MAIN_RSS_LOCALE_SET = new Set<string>(APP_LOCALES);

export function coerceMainRssLocale(value: string): MainRssLocale {
  return MAIN_RSS_LOCALE_SET.has(value) ? (value as MainRssLocale) : "zh";
}

export function mainRssFeedMeta(locale: MainRssLocale): MainRssFeed {
  const meta = MAIN_RSS_FEED_BY_LOCALE.get(locale);
  if (!meta) {
    throw new Error(`unknown main RSS locale: ${locale}`);
  }
  return meta;
}
