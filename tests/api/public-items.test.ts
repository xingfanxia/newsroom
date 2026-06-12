import { describe, expect, test } from "bun:test";
import { toPublicApiItem } from "@/lib/api/public-items";
import type { Story } from "@/lib/types";

const baseStory: Story = {
  id: "42",
  sourceId: "openai-news",
  source: {
    publisher: "OpenAI",
    kindCode: "rss",
    localeCode: "en",
    groupCode: "vendor-official",
  },
  featured: true,
  title: "OpenAI acquires Ona",
  summary: "OpenAI acquired Ona to expand Codex cloud runtime support.",
  tags: ["Agent", "Product update"],
  importance: 92,
  tier: "p1",
  publishedAt: "2026-06-11T00:00:00.000Z",
  url: "https://openai.com/news/ona",
  locale: "en",
  editorNote: "Strategic move for Codex.",
  hkr: {
    h: true,
    k: true,
    r: false,
    reasonsZh: { h: "标题", k: "知识", r: "影响" },
    reasonsEn: { h: "headline", k: "knowledge", r: "resonance" },
  },
};

const expectedKeys = [
  "id",
  "title",
  "summary",
  "publisher",
  "source_id",
  "source_group",
  "source_kind",
  "tier",
  "importance",
  "hkr",
  "tags",
  "url",
  "published_at",
  "has_commentary",
  "cluster_id",
  "coverage",
  "canonical_title",
  "first_seen_at",
  "latest_member_at",
];

describe("toPublicApiItem", () => {
  test("serializes the stable /api/public feed/search item contract", () => {
    const item = toPublicApiItem(
      {
        ...baseStory,
        clusterId: 46266,
        coverage: 2,
        firstSeenAt: "2026-06-11T00:00:00.000Z",
        latestMemberAt: "2026-06-12T09:45:00.000Z",
        canonicalTitleZh: "OpenAI 收购 Ona",
        canonicalTitleEn: "OpenAI acquires Ona",
      },
      "en",
    );

    expect(Object.keys(item)).toEqual(expectedKeys);
    expect(item).toMatchObject({
      id: "42",
      source_id: "openai-news",
      source_group: "vendor-official",
      source_kind: "rss",
      has_commentary: true,
      cluster_id: 46266,
      coverage: 2,
      canonical_title: "OpenAI acquires Ona",
      first_seen_at: "2026-06-11T00:00:00.000Z",
      latest_member_at: "2026-06-12T09:45:00.000Z",
    });
  });

  test("strips per-axis HKR reasons from the anonymous payload", () => {
    const item = toPublicApiItem(baseStory, "en");

    expect(item.hkr).toEqual({ h: true, k: true, r: false });
    expect(item.hkr).not.toHaveProperty("reasonsZh");
    expect(item.hkr).not.toHaveProperty("reasonsEn");
  });

  test("uses the requested locale for canonical event title", () => {
    const zh = toPublicApiItem(
      {
        ...baseStory,
        clusterId: 46266,
        coverage: 2,
        canonicalTitleZh: "OpenAI 收购 Ona",
        canonicalTitleEn: "OpenAI acquires Ona",
      },
      "zh",
    );

    expect(zh.canonical_title).toBe("OpenAI 收购 Ona");
  });

  test("returns null event fields for singleton stories", () => {
    const item = toPublicApiItem(baseStory, "en");

    expect(item.cluster_id).toBeNull();
    expect(item.coverage).toBeNull();
    expect(item.canonical_title).toBeNull();
    expect(item.first_seen_at).toBeNull();
    expect(item.latest_member_at).toBeNull();
  });
});
