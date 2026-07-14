export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);
export const RELEASE_ID = "20260714t120000z-a1b2c3";
export const ISO = "2026-07-14T12:00:00.000Z";

export function artifactDescriptor() {
  return {
    key: `newsroom/v1/objects/sha256/${HASH_A}.json`,
    sha256: HASH_A,
    byteLength: 321,
    mediaType: "application/json" as const,
    encoding: "utf-8" as const,
    shard: { kind: "utc_month" as const, month: "2026-07" },
  };
}

export function snapshotPointer() {
  return {
    schemaVersion: 1 as const,
    active: {
      releaseId: RELEASE_ID,
      manifestKey: `newsroom/v1/releases/${RELEASE_ID}/manifest.json`,
      manifestSha256: HASH_A,
    },
    previous: {
      releaseId: "20260714t110000z-a1b2c3",
      manifestKey:
        "newsroom/v1/releases/20260714t110000z-a1b2c3/manifest.json",
      manifestSha256: HASH_B,
    },
    publishedAt: ISO,
    sourceWatermark: 123,
  };
}

export function snapshotManifest() {
  return {
    schemaVersion: 1 as const,
    releaseId: RELEASE_ID,
    sourceWatermark: 123,
    artifacts: { "items/2026-07": artifactDescriptor() },
  };
}

export function runReceipt() {
  return {
    schemaVersion: 1 as const,
    runId: RELEASE_ID,
    mode: "incremental" as const,
    status: "succeeded" as const,
    startedAt: ISO,
    finishedAt: ISO,
    durationMs: 200,
    sourceWatermark: { from: 100, to: 123 },
    rows: {
      candidate: 12,
      deduped: 10,
      returned: 10,
      scannedRows: 16,
      scanMeasurementKind: "plan_upper_bound" as const,
      queryCount: 4,
      verifiedIndexes: ["public_outbox_pending_idx"],
    },
    changed: {
      items: 5,
      events: 2,
      sources: 1,
      newsletters: 1,
      policies: 0,
      tombstones: 1,
    },
    objects: {
      uploaded: 4,
      reused: 3,
      uploadedBytes: 2048,
      reusedBytes: 1024,
    },
    releaseId: RELEASE_ID,
    failureStage: null,
  };
}

export function item(id = 1) {
  return {
    schemaVersion: 1 as const,
    id,
    sourceId: "openai-news",
    eventId: null,
    title: { raw: "Raw title", zh: "标题", en: "Title" },
    summary: { zh: "摘要", en: "Summary" },
    editorNote: { zh: null, en: null },
    editorAnalysis: { zh: null, en: null },
    bodyMd: "Public, sanitized article markdown",
    author: null,
    url: "https://example.com/story",
    canonicalUrl: "https://example.com/story",
    tags: {
      capabilities: ["agents", "tool-use"],
      entities: ["OpenAI"],
      topics: ["research"],
    },
    importance: 88,
    tier: "featured" as const,
    hkr: { h: true, k: true, r: false },
    publishedAt: ISO,
    createdAt: ISO,
    enrichedAt: ISO,
    commentaryAt: null,
  };
}

export function event() {
  return {
    schemaVersion: 1 as const,
    id: 7,
    leadItemId: 1,
    memberItemIds: [1, 2],
    coverage: 2,
    firstSeenAt: ISO,
    latestMemberAt: ISO,
    canonicalTitle: { zh: "事件", en: "Event" },
    editorNote: { zh: null, en: null },
    editorAnalysis: { zh: null, en: null },
    importance: 90,
    tier: "p1" as const,
    hkr: { h: true, k: false, r: true },
  };
}

export function source() {
  return {
    schemaVersion: 1 as const,
    id: "openai-news",
    name: { zh: "OpenAI 博客", en: "OpenAI Blog" },
    url: "https://openai.com/news/rss.xml",
    kind: "rss" as const,
    group: "vendor-official" as const,
    locale: "en" as const,
    cadence: "daily" as const,
    priority: 1 as const,
    tags: ["OpenAI", "research"],
    enabled: false,
    curated: true,
    health: {
      status: "ok" as const,
      lastSuccessAt: ISO,
      consecutiveFailures: 0,
      totalItemsCount: 42,
    },
    itemCounts: { allTime: 42, last24h: 3 },
  };
}

export function newsletter() {
  return {
    schemaVersion: 1 as const,
    format: "daily_column" as const,
    id: 4,
    kind: "daily" as const,
    locale: "zh" as const,
    periodStart: ISO,
    periodEnd: "2026-07-15T12:00:00.000Z",
    publishedAt: ISO,
    storyCount: 2,
    itemIds: [2, 1],
    title: "今日 AI",
    themeTag: "模型进展",
    summaryMd: "1. 摘要",
    narrativeMd: "正文",
    featuredItemIds: [1],
  };
}

export function policy() {
  return {
    schemaVersion: 1 as const,
    skillName: "editorial" as const,
    version: "v17",
    committedAt: ISO,
  };
}

export function canonicalState() {
  return {
    schemaVersion: 1 as const,
    items: [
      { ...item(1), eventId: 7 },
      { ...item(2), eventId: 7 },
    ],
    events: [event()],
    sources: [source()],
    newsletters: [newsletter()],
    policies: [policy()],
  };
}
