import { describe, expect, test } from "bun:test";
import { toStory, type StoryRow } from "@/lib/items/story-mapper";

const baseRow: StoryRow = {
  id: 42,
  title: "Raw title",
  titleZh: "中文标题",
  titleEn: "English title",
  summaryZh: "中文摘要",
  summaryEn: "English summary",
  editorNoteZh: "中文短评",
  editorNoteEn: "English note",
  editorAnalysisZh: "中文锐评",
  editorAnalysisEn: "English analysis",
  reasoning: "legacy reason",
  reasoningZh: "中文理由",
  reasoningEn: "English reason",
  hkr: { h: true, k: false, r: true },
  url: "https://example.com/story",
  importance: 81,
  tier: "featured",
  tags: {
    capabilities: ["Agent", "RAG"],
    entities: ["OpenAI"],
    topics: ["产品更新"],
  },
  publishedAt: new Date("2026-06-13T12:00:00.000Z"),
  sourceId: "openai-blog",
  sourceNameZh: "OpenAI 中文",
  sourceNameEn: "OpenAI",
  sourceLocale: "en",
  sourceKind: "rss",
  sourceGroup: "vendor-official",
};

describe("toStory", () => {
  test("maps item rows into the shared Story shape", () => {
    expect(
      toStory(baseRow, {
        locale: "zh",
        tagLimit: 2,
        includeSourceGroup: true,
      }),
    ).toMatchObject({
      id: "42",
      sourceId: "openai-blog",
      source: {
        publisher: "OpenAI 中文",
        kindCode: "rss",
        localeCode: "en",
        groupCode: "vendor-official",
      },
      featured: true,
      title: "中文标题",
      summary: "中文摘要",
      tags: ["Agent", "RAG"],
      importance: 81,
      tier: "featured",
      publishedAt: "2026-06-13T12:00:00.000Z",
      url: "https://example.com/story",
      locale: "en",
      editorNote: "中文短评",
      editorAnalysis: "中文锐评",
      reasoning: "中文理由",
      hkr: { h: true, k: false, r: true },
    });
  });

  test("keeps source group optional for surfaces that do not render it", () => {
    expect(
      toStory(baseRow, { locale: "en", tagLimit: 4 }).source.groupCode,
    ).toBeUndefined();
  });

  test("lets event fields override item scoring and commentary", () => {
    const firstSeenAt = new Date("2026-06-12T03:00:00.000Z");
    const latestMemberAt = new Date("2026-06-13T11:00:00.000Z");
    const story = toStory(
      {
        ...baseRow,
        clusterId: 9,
        clusterMemberCount: 4,
        clusterFirstSeenAt: firstSeenAt,
        clusterLatestMemberAt: latestMemberAt,
        clusterCanonicalTitleZh: "事件中文标题",
        clusterCanonicalTitleEn: "Event English title",
        clusterEditorNoteZh: "事件中文短评",
        clusterEditorAnalysisZh: "事件中文锐评",
        clusterImportance: 97,
        clusterEventTier: "p1",
        clusterHkr: { h: false, k: true, r: true },
      },
      {
        locale: "zh",
        tagLimit: 4,
        includeSourceGroup: true,
        nowMs: new Date("2026-06-13T12:00:00.000Z").getTime(),
        startOfTodayMs: new Date("2026-06-13T00:00:00.000Z").getTime(),
        hotWindowMs: 24 * 3_600_000,
      },
    );

    expect(story).toMatchObject({
      title: "事件中文标题",
      editorNote: "事件中文短评",
      editorAnalysis: "事件中文锐评",
      importance: 97,
      tier: "p1",
      featured: true,
      clusterId: 9,
      coverage: 4,
      crossSourceCount: 3,
      firstSeenAt: "2026-06-12T03:00:00.000Z",
      latestMemberAt: "2026-06-13T11:00:00.000Z",
      canonicalTitleZh: "事件中文标题",
      canonicalTitleEn: "Event English title",
      stillDeveloping: true,
      hkr: { h: false, k: true, r: true },
    });
  });

  test("does not fall back to opposite-locale canonical event titles before item title", () => {
    const story = toStory(
      {
        ...baseRow,
        clusterCanonicalTitleEn: "Event English title",
        clusterCanonicalTitleZh: null,
      },
      { locale: "zh", tagLimit: 4, includeSourceGroup: true },
    );

    expect(story.title).toBe("中文标题");
  });
});
