import { describe, expect, test } from "bun:test";
import {
  toAgentFeedPayload,
  toPublicFeedPayload,
  type FeedExecutionResult,
} from "@/lib/api/feed-results";
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

describe("feed result payload serializers", () => {
  test("serializes public and bearer agent feed envelopes from the shared execution result", () => {
    const result = {
      items: [baseStory],
      total: 7,
      limit: 1,
      offset: 2,
      view: "today",
    } satisfies FeedExecutionResult;

    expect(toPublicFeedPayload(result, "en")).toMatchObject({
      total: 7,
      limit: 1,
      offset: 2,
      view: "today",
      items: [
        {
          id: "42",
          source_id: "openai-news",
          hkr: { h: true, k: true, r: false },
        },
      ],
    });
    expect(toAgentFeedPayload(result, "en")).toMatchObject({
      total: 7,
      limit: 1,
      offset: 2,
      view: "today",
      items: [
        {
          id: "42",
          source_id: "openai-news",
          cross_source_count: null,
          hkr: baseStory.hkr,
        },
      ],
    });
  });
});
