import { describe, expect, test } from "bun:test";
import {
  eventMembersCacheSignalParts,
  getEventMembersRequestPayload,
  getEventMembersRoutePayload,
  parseEventMemberRouteParams,
  toEventMemberApiItem,
  toEventMemberApiItems,
  toEventMembersListEnvelope,
  toEventMembersPayload,
} from "@/lib/api/event-members";
import {
  DEFAULT_MCP_EVENT_MEMBERS_LOCALE,
  DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE,
  DEFAULT_UI_EVENT_MEMBERS_LOCALE,
  DEFAULT_V1_EVENT_MEMBERS_LOCALE,
} from "@/lib/event-members/query-defaults";
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
  test("exposes per-surface locale defaults", () => {
    expect(DEFAULT_UI_EVENT_MEMBERS_LOCALE).toBe("zh");
    expect(DEFAULT_V1_EVENT_MEMBERS_LOCALE).toBe("zh");
    expect(DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE).toBe("en");
    expect(DEFAULT_MCP_EVENT_MEMBERS_LOCALE).toBe("en");
  });

  test("parses shared route params with per-surface locale defaults", () => {
    expect(
      parseEventMemberRouteParams({
        rawId: "42",
        rawLocale: null,
        defaultLocale: DEFAULT_UI_EVENT_MEMBERS_LOCALE,
      }),
    ).toEqual({ ok: true, clusterId: 42, locale: "zh" });
    expect(
      parseEventMemberRouteParams({
        rawId: "42",
        rawLocale: null,
        defaultLocale: DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE,
      }),
    ).toEqual({ ok: true, clusterId: 42, locale: "en" });
    expect(
      parseEventMemberRouteParams({
        rawId: "42",
        rawLocale: "en",
        defaultLocale: DEFAULT_V1_EVENT_MEMBERS_LOCALE,
      }),
    ).toEqual({ ok: true, clusterId: 42, locale: "en" });
  });

  test("rejects invalid route ids and locale query values", () => {
    expect(
      parseEventMemberRouteParams({
        rawId: "0",
        rawLocale: null,
        defaultLocale: DEFAULT_UI_EVENT_MEMBERS_LOCALE,
      }),
    ).toEqual({ ok: false, error: "invalid_id" });
    expect(
      parseEventMemberRouteParams({
        rawId: "42",
        rawLocale: "",
        defaultLocale: DEFAULT_UI_EVENT_MEMBERS_LOCALE,
      }),
    ).toEqual({ ok: false, error: "invalid_locale" });
    expect(
      parseEventMemberRouteParams({
        rawId: "42",
        rawLocale: "ja",
        defaultLocale: DEFAULT_UI_EVENT_MEMBERS_LOCALE,
      }),
    ).toEqual({ ok: false, error: "invalid_locale" });
  });

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

  test("builds the shared event members payload envelope", () => {
    const payload = toEventMembersPayload(42, [
      member,
      { ...member, sourceId: "anthropic-news", sourceName: "Anthropic" },
    ]);

    expect(payload).toEqual({
      cluster_id: 42,
      members: [
        toEventMemberApiItem(member),
        toEventMemberApiItem({
          ...member,
          sourceId: "anthropic-news",
          sourceName: "Anthropic",
        }),
      ],
      total: 2,
    });
    expect(toEventMembersListEnvelope(payload)).toEqual({
      members: payload.members,
      total: 2,
    });
    expect(eventMembersCacheSignalParts(payload)).toEqual({
      cluster_id: 42,
      n: 2,
      last_at: "2026-06-11T00:00:00.000Z",
    });
  });

  test("route payload lookup returns shared validation errors before fetching", async () => {
    await expect(
      getEventMembersRoutePayload({
        rawId: "0",
        rawLocale: null,
        defaultLocale: DEFAULT_UI_EVENT_MEMBERS_LOCALE,
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_id", status: 400 });

    await expect(
      getEventMembersRoutePayload({
        rawId: "42",
        rawLocale: "ja",
        defaultLocale: DEFAULT_UI_EVENT_MEMBERS_LOCALE,
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_locale", status: 400 });

    await expect(
      getEventMembersRequestPayload(
        new Request("https://example.test/api/events/42/members?locale=ja"),
        {
          rawId: "42",
          defaultLocale: DEFAULT_UI_EVENT_MEMBERS_LOCALE,
        },
      ),
    ).resolves.toEqual({ ok: false, error: "invalid_locale", status: 400 });
  });
});
