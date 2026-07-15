import type { CanonicalPublicState } from "@/lib/public-content/contracts";

export const PARITY_NOW_ISO = "2026-07-14T12:00:00.000Z";
export const PARITY_NOW_MS = Date.parse(PARITY_NOW_ISO);

type PublicItem = CanonicalPublicState["items"][number];
type PublicSource = CanonicalPublicState["sources"][number];

function source(
  value: Omit<
    PublicSource,
    "schemaVersion" | "cadence" | "health" | "itemCounts"
  > & {
    itemCounts: PublicSource["itemCounts"];
  },
): PublicSource {
  return {
    schemaVersion: 1,
    cadence: "daily",
    health: {
      status: "ok",
      lastSuccessAt: "2026-07-14T11:45:00.000Z",
      consecutiveFailures: 0,
      totalItemsCount: value.itemCounts.allTime,
    },
    ...value,
  };
}

function item(
  value: Pick<
    PublicItem,
    | "id"
    | "sourceId"
    | "eventId"
    | "title"
    | "summary"
    | "importance"
    | "tier"
    | "publishedAt"
    | "createdAt"
  > &
    Partial<
      Pick<
        PublicItem,
        | "editorNote"
        | "editorAnalysis"
        | "bodyMd"
        | "author"
        | "tags"
        | "hkr"
        | "commentaryAt"
      >
    >,
): PublicItem {
  return {
    schemaVersion: 1,
    editorNote: { zh: null, en: null },
    editorAnalysis: { zh: null, en: null },
    bodyMd: null,
    author: null,
    url: `https://example.com/items/${value.id}`,
    canonicalUrl: `https://example.com/items/${value.id}`,
    tags: { capabilities: [], entities: [], topics: [] },
    hkr: null,
    enrichedAt: value.createdAt,
    commentaryAt: null,
    ...value,
  };
}

export const PARITY_STATE = {
  schemaVersion: 1,
  sources: [
    source({
      id: "alpha-podcast",
      name: { zh: "阿尔法播客", en: "Alpha Podcast" },
      url: "https://example.com/alpha.xml",
      kind: "rss",
      group: "podcast",
      locale: "en",
      priority: 1,
      tags: ["audio", "preferred"],
      enabled: true,
      curated: false,
      itemCounts: { allTime: 30, last24h: 3 },
    }),
    source({
      id: "beta-x",
      name: { zh: "贝塔动态", en: "Beta Updates" },
      url: "https://x.com/beta_ai",
      kind: "x-api",
      group: "social",
      locale: "en",
      priority: 2,
      tags: ["social"],
      enabled: true,
      curated: true,
      itemCounts: { allTime: 20, last24h: 4 },
    }),
    source({
      id: "gamma-media",
      name: { zh: "伽马媒体", en: "Gamma Media" },
      url: "https://example.com/gamma.xml",
      kind: "rss",
      group: "media",
      locale: "multi",
      priority: 3,
      tags: ["blocked", "media"],
      enabled: false,
      curated: true,
      itemCounts: { allTime: 40, last24h: 2 },
    }),
    source({
      id: "delta-vendor",
      name: { zh: "德尔塔官方", en: "Delta Official" },
      url: "https://example.com/delta",
      kind: "api",
      group: "vendor-official",
      locale: "multi",
      priority: 1,
      tags: ["preferred", "official"],
      enabled: true,
      curated: false,
      itemCounts: { allTime: 12, last24h: 1 },
    }),
  ],
  items: [
    item({
      id: 1,
      sourceId: "alpha-podcast",
      eventId: 100,
      title: { raw: "Alpha launch", zh: "Alpha 发布", en: "Alpha launches" },
      summary: { zh: "Alpha 摘要", en: "Alpha summary" },
      editorNote: { zh: "条目短评", en: "Item note" },
      editorAnalysis: { zh: "条目分析", en: "Item analysis" },
      bodyMd: "Alpha public body",
      tags: {
        capabilities: ["agents"],
        entities: ["Alpha"],
        topics: ["launch", "research"],
      },
      importance: 70,
      tier: "all",
      hkr: { h: false, k: true, r: false },
      publishedAt: "2026-07-14T10:00:00.000Z",
      createdAt: "2026-07-14T10:05:00.000Z",
      commentaryAt: "2026-07-14T10:30:00.000Z",
    }),
    item({
      id: 2,
      sourceId: "beta-x",
      eventId: 100,
      title: { raw: "Alpha follow-up", zh: "Alpha 后续", en: "Alpha follow-up" },
      summary: { zh: "后续摘要", en: "Follow-up summary" },
      importance: 90,
      tier: "p1",
      publishedAt: "2026-07-14T11:00:00.000Z",
      createdAt: "2026-07-14T11:05:00.000Z",
    }),
    item({
      id: 3,
      sourceId: "beta-x",
      eventId: null,
      title: { raw: "Model A100x", zh: "模型 A100x", en: "Model A100x" },
      summary: { zh: "通配符 alpha_100%", en: "Wildcard alpha_100%" },
      editorNote: { zh: "贝塔短评", en: "Beta note" },
      tags: { capabilities: ["models"], entities: ["Beta"], topics: ["benchmarks"] },
      importance: 88,
      tier: "p1",
      hkr: { h: true, k: false, r: true },
      publishedAt: "2026-07-14T09:00:00.000Z",
      createdAt: "2026-07-14T09:05:00.000Z",
    }),
    item({
      id: 4,
      sourceId: "gamma-media",
      eventId: null,
      title: { raw: "Gamma analysis", zh: "伽马分析", en: "Gamma analysis" },
      summary: { zh: "媒体摘要", en: "Media summary" },
      importance: 92,
      tier: "featured",
      hkr: { h: true, k: true, r: true },
      publishedAt: "2026-07-13T20:00:00.000Z",
      createdAt: "2026-07-13T20:05:00.000Z",
    }),
    item({
      id: 5,
      sourceId: "delta-vendor",
      eventId: 101,
      title: { raw: "Delta preview", zh: "德尔塔预览", en: "Delta preview" },
      summary: { zh: "官方预览", en: "Official preview" },
      importance: 60,
      tier: "all",
      publishedAt: "2026-07-13T12:00:00.000Z",
      createdAt: "2026-07-13T12:00:00.000Z",
    }),
    item({
      id: 6,
      sourceId: "alpha-podcast",
      eventId: 101,
      title: { raw: "Delta discussion", zh: "德尔塔讨论", en: "Delta discussion" },
      summary: { zh: "讨论摘要", en: "Discussion summary" },
      importance: 64,
      tier: "all",
      publishedAt: "2026-07-13T11:00:00.000Z",
      createdAt: "2026-07-13T11:00:00.000Z",
    }),
    item({
      id: 7,
      sourceId: "delta-vendor",
      eventId: null,
      title: { raw: "Older signal", zh: "较早信号", en: "Older signal" },
      summary: { zh: "历史摘要", en: "Historical summary" },
      importance: 85,
      tier: "all",
      publishedAt: "2026-07-10T16:00:00.000Z",
      createdAt: "2026-07-10T16:00:00.000Z",
    }),
    item({
      id: 8,
      sourceId: "gamma-media",
      eventId: null,
      title: { raw: "Fresh rescue", zh: "新鲜补位", en: "Fresh rescue" },
      summary: { zh: "低分但新鲜", en: "Fresh despite a low score" },
      importance: 40,
      tier: "all",
      publishedAt: "2026-07-14T08:00:00.000Z",
      createdAt: "2026-07-14T08:00:00.000Z",
    }),
    item({
      id: 9,
      sourceId: "alpha-podcast",
      eventId: null,
      title: { raw: "Fallback title", zh: null, en: "English fallback" },
      summary: { zh: null, en: "Fallback summary" },
      importance: 91,
      tier: "featured",
      publishedAt: "2026-07-12T22:00:00.000Z",
      createdAt: "2026-07-12T22:00:00.000Z",
    }),
    item({
      id: 10,
      sourceId: "delta-vendor",
      eventId: null,
      title: { raw: "Delta release", zh: "德尔塔发布", en: "Delta release" },
      summary: { zh: "发布摘要", en: "Release summary" },
      importance: 93,
      tier: "featured",
      hkr: { h: false, k: true, r: true },
      publishedAt: "2026-07-13T23:00:00.000Z",
      createdAt: "2026-07-13T23:00:00.000Z",
    }),
  ],
  events: [
    {
      schemaVersion: 1,
      id: 100,
      leadItemId: 1,
      memberItemIds: [1, 2],
      coverage: 2,
      firstSeenAt: "2026-07-13T08:00:00.000Z",
      latestMemberAt: "2026-07-14T11:00:00.000Z",
      canonicalTitle: { zh: "Alpha 事件", en: "Alpha event" },
      editorNote: { zh: "事件短评", en: "Event note" },
      editorAnalysis: { zh: "事件分析", en: "Event analysis" },
      importance: 95,
      tier: "featured",
      hkr: { h: true, k: true, r: false },
    },
    {
      schemaVersion: 1,
      id: 101,
      leadItemId: 5,
      memberItemIds: [5, 6],
      coverage: 2,
      firstSeenAt: "2026-07-14T01:00:00.000Z",
      latestMemberAt: "2026-07-14T02:00:00.000Z",
      canonicalTitle: { zh: "德尔塔事件", en: "Delta event" },
      editorNote: { zh: null, en: null },
      editorAnalysis: { zh: null, en: null },
      importance: 65,
      tier: "all",
      hkr: null,
    },
  ],
  newsletters: [
    {
      schemaVersion: 1,
      format: "daily_column",
      id: 201,
      kind: "daily",
      locale: "zh",
      periodStart: "2026-07-14T00:00:00.000Z",
      periodEnd: "2026-07-15T00:00:00.000Z",
      publishedAt: "2026-07-14T11:30:00.000Z",
      storyCount: 3,
      itemIds: [1, 3, 8],
      title: "今日模型与产品",
      themeTag: "模型进展",
      summaryMd: "今日摘要",
      narrativeMd: "今日正文",
      featuredItemIds: [1, 3],
    },
    {
      schemaVersion: 1,
      format: "daily_column",
      id: 202,
      kind: "daily",
      locale: "zh",
      periodStart: "2026-07-13T00:00:00.000Z",
      periodEnd: "2026-07-14T00:00:00.000Z",
      publishedAt: "2026-07-13T11:30:00.000Z",
      storyCount: 2,
      itemIds: [4, 10],
      title: "昨日回顾",
      themeTag: "行业动态",
      summaryMd: "昨日摘要",
      narrativeMd: "昨日正文",
      featuredItemIds: [4],
    },
    {
      schemaVersion: 1,
      format: "structured",
      id: 203,
      kind: "daily",
      locale: "en",
      periodStart: "2026-07-14T00:00:00.000Z",
      periodEnd: "2026-07-15T00:00:00.000Z",
      publishedAt: "2026-07-14T11:40:00.000Z",
      storyCount: 2,
      itemIds: [1, 3],
      headline: "Daily signal",
      overview: "Two important stories.",
      highlights: "- Alpha\n- Beta",
      commentary: "Watch the follow-through.",
    },
    {
      schemaVersion: 1,
      format: "structured",
      id: 204,
      kind: "monthly",
      locale: "zh",
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-07-15T00:00:00.000Z",
      publishedAt: "2026-07-14T10:00:00.000Z",
      storyCount: 2,
      itemIds: [4, 10],
      headline: "月度信号",
      overview: "两条重要故事。",
      highlights: "- 伽马\n- 德尔塔",
      commentary: "继续观察。",
    },
  ],
  policies: [
    {
      schemaVersion: 1,
      skillName: "editorial",
      version: "v18",
      committedAt: "2026-07-14T11:50:00.000Z",
    },
  ],
} satisfies CanonicalPublicState;

export const PARITY_STATE_SHA256 =
  "e418c8d4ad6bb65555593d84cd6f9279a4225b175190e49fb61e96fd916cc6fa";

export const EXPECTED_QUERY_IDS: Record<string, number[]> = {
  all: [1, 3, 8, 10, 4, 5, 9, 7],
  featured: [1, 3, 10, 4, 9],
  p1: [3],
  sourcePrecedence: [3],
  curated: [3, 8, 4],
  includePreferred: [1, 10, 5, 9, 7],
  excludeBlocked: [1, 3, 10, 5, 9, 7],
  dateJuly13: [10, 4, 5],
  range: [3, 8, 10],
  today: [1, 3, 8, 10, 4, 5],
  rescued: [1, 3, 8, 10, 4, 5, 9],
  recencyFloor: [1, 3, 8, 10, 4, 5, 9],
  onePerDay: [1, 10, 9, 7],
  wildcard: [3],
};

export const EXPECTED_RSS_SHA256 = {
  mainZh: "b2b8df57af7fca141d11e96604b19e5cc8ba11f15ed2a0ed5c0fa3c415c520a0",
  mainEn: "8e09e10cfbe86ea54c1f8e0e3003e6c562e01dcf06f9dcb82ebbd317cba0a9ea",
  newsletterEn: "0bd548f595c518e7c101d8a8aa4c0d3bc7a3b29295fbf7da8eda0be3c897c33e",
  legacyToday: "85f49745daada19c21638594294fe6b0520ac07248d139fe34d051046552d0df",
  legacyCurated: "ce3ba8dc07b69fd81135a77103f90fc21e0b74e7feb89652d0b05cdfa9106e1d",
  legacyDaily: "9a784a8b26b082bf97513cb8f1116a665edc732f5fe21f8544e046c953c59d03",
} as const;
