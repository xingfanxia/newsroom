import { describe, expect, test } from "bun:test";
import {
  parseItemDetailRouteId,
  publicItemDetailEtagSignal,
  toPublicItemDetail,
  toV1ItemDetail,
  type ItemDetailRow,
} from "@/lib/api/item-detail";

const publishedAt = new Date("2026-06-11T10:00:00.000Z");
const enrichedAt = new Date("2026-06-11T10:10:00.000Z");
const commentaryAt = new Date("2026-06-11T10:20:00.000Z");
const clusterCommentaryAt = new Date("2026-06-11T10:30:00.000Z");

function detailRow(overrides: Partial<ItemDetailRow> = {}): ItemDetailRow {
  return {
    id: 42,
    sourceId: "openai-news",
    clusterId: 46266,
    title: "OpenAI acquires Ona",
    titleZh: "OpenAI 收购 Ona",
    titleEn: "OpenAI acquires Ona",
    summaryZh: "OpenAI 收购 Ona 来扩展 Codex 云端运行时。",
    summaryEn: "OpenAI acquired Ona to expand Codex cloud runtime support.",
    body: "<p>rss body</p>",
    bodyMd: "# Body",
    editorNoteZh: "Codex 运行时继续补位。",
    editorNoteEn: "Strategic move for Codex.",
    editorAnalysisZh: "长评 zh",
    editorAnalysisEn: "Long analysis en",
    reasoning: "legacy reason",
    reasoningZh: "中文理由",
    reasoningEn: "English reason",
    hkr: {
      h: true,
      k: true,
      r: false,
      reasonsZh: { h: "标题", k: "知识", r: "影响" },
      reasonsEn: { h: "headline", k: "knowledge", r: "resonance" },
    },
    url: "https://openai.com/news/ona",
    canonicalUrl: "https://openai.com/news/ona",
    importance: 92,
    tier: "p1",
    tags: {
      capabilities: ["Agent"],
      entities: ["OpenAI"],
      topics: ["Product"],
    },
    publishedAt,
    enrichedAt,
    commentaryAt,
    author: "OpenAI",
    sourceNameEn: "OpenAI",
    sourceNameZh: "OpenAI",
    sourceKind: "rss",
    sourceGroup: "vendor-official",
    sourceLocale: "en",
    sourceUrl: "https://openai.com/news/rss.xml",
    clusterMemberCount: 3,
    clusterCanonicalTitleZh: "OpenAI 收购 Ona",
    clusterCanonicalTitleEn: "OpenAI acquires Ona",
    clusterEditorNoteZh: "事件短评 zh",
    clusterEditorNoteEn: "Event note en",
    clusterEditorAnalysisZh: "事件长评 zh",
    clusterEditorAnalysisEn: "Event analysis en",
    clusterFirstSeenAt: publishedAt,
    clusterLatestMemberAt: enrichedAt,
    clusterCommentaryAt,
    clusterEventTier: "p1",
    clusterImportance: 95,
    clusterVerifiedAt: commentaryAt,
    ...overrides,
  } as ItemDetailRow;
}

describe("parseItemDetailRouteId", () => {
  test("accepts positive integer route ids", () => {
    expect(parseItemDetailRouteId("42")).toEqual({ ok: true, id: 42 });
  });

  test("rejects invalid route ids", () => {
    expect(parseItemDetailRouteId("0")).toEqual({
      ok: false,
      error: "invalid_id",
    });
    expect(parseItemDetailRouteId("abc")).toEqual({
      ok: false,
      error: "invalid_id",
    });
  });
});

describe("toV1ItemDetail", () => {
  test("keeps the bearer-gated full detail contract", () => {
    const item = toV1ItemDetail(detailRow());

    expect(item).toMatchObject({
      id: "42",
      source: {
        id: "openai-news",
        kind: "rss",
        group: "vendor-official",
      },
      title: {
        raw: "OpenAI acquires Ona",
        zh: "OpenAI 收购 Ona",
        en: "OpenAI acquires Ona",
      },
      reasoning: {
        legacy: "legacy reason",
        zh: "中文理由",
        en: "English reason",
      },
      body_rss: "<p>rss body</p>",
      event: {
        cluster_id: 46266,
        coverage: 3,
        verified_at: commentaryAt.toISOString(),
        commentary_at: clusterCommentaryAt.toISOString(),
        members_url: "/api/v1/events/46266/members",
      },
    });
    expect(item.hkr).toHaveProperty("reasonsZh");
    expect(item.tags).toEqual({
      capabilities: ["Agent"],
      entities: ["OpenAI"],
      topics: ["Product"],
    });
  });
});

describe("toPublicItemDetail", () => {
  test("strips LLM internals while keeping public detail fields", () => {
    const item = toPublicItemDetail(detailRow());

    expect(Object.keys(item)).not.toContain("reasoning");
    expect(Object.keys(item)).not.toContain("body_rss");
    expect(item.hkr).toEqual({ h: true, k: true, r: false });
    expect(item.hkr).not.toHaveProperty("reasonsZh");
    expect(item.event).toMatchObject({
      cluster_id: 46266,
      coverage: 3,
      members_url: "/api/public/events/46266/members",
    });
    expect(item.event).not.toHaveProperty("verified_at");
    expect(item.event).not.toHaveProperty("commentary_at");
  });

  test("keeps event null for singleton rows", () => {
    expect(
      toPublicItemDetail(
        detailRow({ clusterId: 46266, clusterMemberCount: 1 }),
      ).event,
    ).toBeNull();
  });
});

describe("publicItemDetailEtagSignal", () => {
  test("changes when event-level commentary changes", () => {
    const before = publicItemDetailEtagSignal(
      detailRow({ clusterCommentaryAt }),
    );
    const after = publicItemDetailEtagSignal(
      detailRow({
        clusterCommentaryAt: new Date("2026-06-11T11:30:00.000Z"),
      }),
    );

    expect(before).toContain(
      `cluster_commentary_at=${clusterCommentaryAt.toISOString()}`,
    );
    expect(after).not.toBe(before);
  });
});
