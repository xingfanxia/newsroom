import { describe, expect, test } from "bun:test";
import { toAgentApiItem } from "@/lib/api/v1-items";
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
  hkr: { h: true, k: true, r: false },
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
  "cross_source_count",
  "cluster_id",
  "coverage",
  "canonical_title",
  "first_seen_at",
  "latest_member_at",
  "still_developing",
];

describe("toAgentApiItem", () => {
  test("serializes the stable /api/v1 feed/search item contract", () => {
    const item = toAgentApiItem(
      {
        ...baseStory,
        crossSourceCount: 3,
        clusterId: 46266,
        coverage: 2,
        firstSeenAt: "2026-06-11T00:00:00.000Z",
        latestMemberAt: "2026-06-12T09:45:00.000Z",
        canonicalTitleZh: "OpenAI 收购 Ona",
        canonicalTitleEn: "OpenAI acquires Ona",
        stillDeveloping: true,
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
      cross_source_count: 3,
      cluster_id: 46266,
      coverage: 2,
      canonical_title: "OpenAI acquires Ona",
      first_seen_at: "2026-06-11T00:00:00.000Z",
      latest_member_at: "2026-06-12T09:45:00.000Z",
      still_developing: true,
    });
  });

  test("uses the requested locale for canonical event title", () => {
    const zh = toAgentApiItem(
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
    const item = toAgentApiItem(baseStory, "en");

    expect(item.cross_source_count).toBeNull();
    expect(item.cluster_id).toBeNull();
    expect(item.coverage).toBeNull();
    expect(item.canonical_title).toBeNull();
    expect(item.first_seen_at).toBeNull();
    expect(item.latest_member_at).toBeNull();
    expect(item.still_developing).toBeNull();
  });
});
