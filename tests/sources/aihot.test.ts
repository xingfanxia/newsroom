/**
 * Unit tests for lib/sources/aihot.ts.
 *
 * Mocks globalThis.fetch in beforeEach, restores in afterEach. Covers the 10
 * cases in the spec: happy paths, error mapping, cursor pagination, date and
 * take validation, and the FeedItem adapter.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  AihotError,
  aihotItemToFeedItem,
  fetchAllItems,
  fetchDailiesIndex,
  fetchDailyByDate,
  fetchItems,
  type AihotDailyReport,
  type AihotItem,
  type AihotItemsResponse,
} from "../../lib/sources/aihot";
import { sourceCatalog } from "../../lib/sources/catalog";

// ── fetch mock plumbing ──────────────────────────────────────────────────

type FetchCall = { url: string; init: RequestInit | undefined };
let calls: FetchCall[] = [];
let handlers: Array<(c: FetchCall) => Response | Promise<Response>> = [];
const realFetch = globalThis.fetch;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  calls = [];
  handlers = [];
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    calls.push({ url, init });
    const handler = handlers.shift();
    if (!handler) throw new Error(`unexpected fetch call: ${url}`);
    return await handler({ url, init });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const queue = (...rs: Response[]) => handlers.push(...rs.map((r) => () => r));

const item = (overrides: Partial<AihotItem> = {}): AihotItem => ({
  id: "ckabc1234567890123456789a",
  title: "Sample title",
  title_en: null,
  url: "https://example.com/post/1",
  source: "Example Source",
  publishedAt: "2026-05-01T12:00:00Z",
  summary: "A short summary.",
  category: "industry",
  ...overrides,
});

const itemsRes = (
  overrides: Partial<AihotItemsResponse> = {},
): AihotItemsResponse => ({
  count: 1,
  hasNext: false,
  nextCursor: null,
  items: [item()],
  ...overrides,
});

// ── tests ────────────────────────────────────────────────────────────────

describe("fetchItems", () => {
  test("happy path: returns shape, sends UA + mode/take/category/since", async () => {
    queue(json(itemsRes({ count: 2 })));
    const res = await fetchItems({
      mode: "all",
      take: 25,
      category: "ai-models",
      since: "2026-04-30T00:00:00Z",
    });
    expect(res.count).toBe(2);
    expect(res.items[0].id).toBe("ckabc1234567890123456789a");

    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/api/public/items");
    expect(u.searchParams.get("mode")).toBe("all");
    expect(u.searchParams.get("take")).toBe("25");
    expect(u.searchParams.get("category")).toBe("ai-models");
    expect(u.searchParams.get("since")).toBe("2026-04-30T00:00:00Z");

    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers["User-Agent"]).toContain("Mozilla/5.0");
    expect(headers["Accept"]).toBe("application/json");
  });

  test("400 → AihotError code='invalid_param' with body.error message", async () => {
    queue(json({ error: "take must be 1..100" }, 400));
    let caught: unknown;
    try {
      await fetchItems({ take: 1 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AihotError);
    expect((caught as AihotError).code).toBe("invalid_param");
    expect((caught as AihotError).message).toContain("take must be 1..100");
  });

  test("429 → AihotError code='rate_limited'", async () => {
    queue(json({}, 429));
    let caught: unknown;
    try {
      await fetchItems();
    } catch (err) {
      caught = err;
    }
    expect((caught as AihotError).code).toBe("rate_limited");
  });

  test("since in future → invalid_param (no fetch call)", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    let caught: unknown;
    try {
      await fetchItems({ since: future });
    } catch (err) {
      caught = err;
    }
    expect((caught as AihotError).code).toBe("invalid_param");
    expect(calls).toHaveLength(0);
  });
});

describe("cursor pagination via fetchAllItems", () => {
  test("first call no cursor; second uses returned nextCursor; stops on hasNext=false", async () => {
    queue(
      json(
        itemsRes({
          hasNext: true,
          nextCursor: "OPAQUE_PAGE_2",
          items: [item({ id: "id-1" })],
        }),
      ),
      json(
        itemsRes({
          hasNext: true,
          nextCursor: "OPAQUE_PAGE_3",
          items: [item({ id: "id-2" })],
        }),
      ),
      json(
        itemsRes({
          hasNext: false,
          nextCursor: null,
          items: [item({ id: "id-3" })],
        }),
      ),
    );
    const all = await fetchAllItems({ take: 10, maxItems: 50 });
    expect(all.map((i) => i.id)).toEqual(["id-1", "id-2", "id-3"]);
    expect(calls).toHaveLength(3);
    expect(new URL(calls[0].url).searchParams.get("cursor")).toBeNull();
    expect(new URL(calls[1].url).searchParams.get("cursor")).toBe(
      "OPAQUE_PAGE_2",
    );
    expect(new URL(calls[2].url).searchParams.get("cursor")).toBe(
      "OPAQUE_PAGE_3",
    );
  });

  test("respects maxItems cap mid-page", async () => {
    queue(
      json(
        itemsRes({
          hasNext: true,
          nextCursor: "P2",
          items: [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })],
        }),
      ),
    );
    const all = await fetchAllItems({ maxItems: 2 });
    expect(all).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });
});

describe("fetchDailyByDate", () => {
  const daily: AihotDailyReport = {
    date: "2026-05-01",
    generatedAt: "2026-05-01T08:00:00Z",
    windowStart: "2026-04-30T00:00:00Z",
    windowEnd: "2026-05-01T00:00:00Z",
    lead: { title: "Lead", leadParagraph: "Para." },
    sections: [
      {
        label: "模型发布/更新",
        items: [
          {
            title: "GPT-X",
            summary: "It launched.",
            sourceUrl: "https://x.com/p",
            sourceName: "X",
          },
        ],
      },
    ],
    flashes: [
      {
        title: "Flash",
        sourceName: "Y",
        sourceUrl: "https://y.com/p",
        publishedAt: "2026-05-01T07:00:00Z",
      },
    ],
  };

  test("happy path returns full structure; uses /api/public/daily/{date}", async () => {
    queue(json(daily));
    const res = await fetchDailyByDate("2026-05-01");
    expect(res?.date).toBe("2026-05-01");
    expect(res?.sections[0].label).toBe("模型发布/更新");
    expect(res?.flashes[0].title).toBe("Flash");
    expect(new URL(calls[0].url).pathname).toBe("/api/public/daily/2026-05-01");
  });

  test("404 → returns null (does NOT throw)", async () => {
    queue(json({ error: "No daily report for 2026-05-01." }, 404));
    expect(await fetchDailyByDate("2026-05-01")).toBeNull();
  });

  test("invalid YYYY-MM-DD → invalid_param (no fetch)", async () => {
    let caught: unknown;
    try {
      await fetchDailyByDate("2026/05/01");
    } catch (err) {
      caught = err;
    }
    expect((caught as AihotError).code).toBe("invalid_param");
    expect(calls).toHaveLength(0);
  });
});

describe("fetchDailiesIndex", () => {
  test("clamps take=200 → take=180 silently", async () => {
    queue(json({ count: 0, items: [] }));
    await fetchDailiesIndex(200);
    expect(new URL(calls[0].url).searchParams.get("take")).toBe("180");
  });
});

describe("aihotItemToFeedItem", () => {
  test("happy path: rawPayload has body + content:encoded keys", () => {
    const fi = aihotItemToFeedItem(item());
    expect(fi?.externalId).toBe("ckabc1234567890123456789a");
    expect(fi?.url).toBe("https://example.com/post/1");
    expect(fi?.title).toBe("Sample title");
    expect(fi?.publishedAt).toBeInstanceOf(Date);
    const raw = fi?.rawPayload as Record<string, unknown>;
    expect(raw.body).toBe("A short summary.");
    expect(raw["content:encoded"]).toBe("A short summary.");
  });

  test("returns null when id or url missing", () => {
    expect(aihotItemToFeedItem(item({ id: "" }))).toBeNull();
    expect(aihotItemToFeedItem(item({ url: "" }))).toBeNull();
  });

  test("missing summary → body and content:encoded are empty strings", () => {
    const fi = aihotItemToFeedItem(item({ summary: null }));
    const raw = fi?.rawPayload as Record<string, unknown>;
    expect(raw.body).toBe("");
    expect(raw["content:encoded"]).toBe("");
  });
});

describe("AI HOT source configuration", () => {
  test("individual selected articles remain eligible for event clustering", () => {
    const source = sourceCatalog.find(({ id }) => id === "aihot-selected");
    expect(source).toBeDefined();
    expect(source?.curated).toBe(true);
    expect(source?.clusteringOptOut ?? false).toBe(false);
  });
});
