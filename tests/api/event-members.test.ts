import { describe, expect, test } from "bun:test";
import {
  toEventMemberApiItem,
  toEventMemberApiItems,
} from "@/lib/api/event-members";
import type { Story } from "@/lib/types";

const member: NonNullable<Story["members"]>[number] = {
  sourceId: "openai-news",
  sourceName: "OpenAI",
  title: "OpenAI acquires Ona",
  url: "https://openai.com/news/ona",
  publishedAt: "2026-06-11T00:00:00.000Z",
  importance: 92,
};

const expectedKeys = [
  "source_id",
  "source_name",
  "title",
  "url",
  "published_at",
  "importance",
];

describe("event member API serialization", () => {
  test("serializes the shared event members item contract", () => {
    const item = toEventMemberApiItem(member);

    expect(Object.keys(item)).toEqual(expectedKeys);
    expect(item).toEqual({
      source_id: "openai-news",
      source_name: "OpenAI",
      title: "OpenAI acquires Ona",
      url: "https://openai.com/news/ona",
      published_at: "2026-06-11T00:00:00.000Z",
      importance: 92,
    });
  });

  test("maps lists without changing order", () => {
    const items = toEventMemberApiItems([
      member,
      { ...member, sourceId: "anthropic-news", sourceName: "Anthropic" },
    ]);

    expect(items.map((item) => item.source_id)).toEqual([
      "openai-news",
      "anthropic-news",
    ]);
  });
});
