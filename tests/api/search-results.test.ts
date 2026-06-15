import { describe, expect, test } from "bun:test";
import {
  toAgentSearchPayload,
  toPublicSearchPayload,
  type SearchExecutionResult,
} from "@/lib/api/search-results";
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

describe("search result payload serializers", () => {
  test("serializes lexical search for public and bearer agent surfaces", () => {
    const result = {
      mode: "lexical",
      q: "codex",
      items: [baseStory],
      total: 7,
      limit: 1,
      offset: 2,
    } satisfies SearchExecutionResult;

    expect(toPublicSearchPayload(result, "en")).toMatchObject({
      mode: "lexical",
      q: "codex",
      total: 7,
      limit: 1,
      offset: 2,
      items: [
        {
          id: "42",
          source_id: "openai-news",
          hkr: { h: true, k: true, r: false },
        },
      ],
    });
    expect(toAgentSearchPayload(result, "en")).toMatchObject({
      mode: "lexical",
      q: "codex",
      total: 7,
      limit: 1,
      offset: 2,
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

  test("serializes semantic metadata without leaking agent-only embedding dims publicly", () => {
    const result = {
      mode: "semantic",
      q: "autonomous coding agent",
      items: [{ ...baseStory, distance: 0.123 }],
      total: 1,
      limit: 5,
      offset: 0,
      embeddingDims: 3072,
      latencyMs: 42,
    } satisfies SearchExecutionResult;

    const publicPayload = toPublicSearchPayload(result, "zh");
    expect(publicPayload).toMatchObject({
      mode: "semantic",
      q: "autonomous coding agent",
      total: 1,
      limit: 5,
      offset: 0,
      latency_ms: 42,
      items: [{ id: "42", distance: 0.123 }],
    });
    expect(publicPayload).not.toHaveProperty("embedding_dims");

    expect(toAgentSearchPayload(result, "zh")).toMatchObject({
      mode: "semantic",
      q: "autonomous coding agent",
      total: 1,
      limit: 5,
      offset: 0,
      embedding_dims: 3072,
      latency_ms: 42,
      items: [{ id: "42", distance: 0.123 }],
    });
  });
});
