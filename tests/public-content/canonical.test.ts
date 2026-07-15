import { describe, expect, test } from "bun:test";
import {
  canonicalJsonBytes,
  canonicalPublicStateBytes,
  canonicalPublicStateSha256,
  canonicalSha256,
} from "@/lib/public-content/canonical";

const ISO = "2026-07-14T12:00:00.000Z";

function state() {
  const source = (id: string) => ({
    schemaVersion: 1 as const,
    id,
    name: { zh: id, en: id },
    url: `https://example.com/${id}`,
    kind: "rss" as const,
    group: "media" as const,
    locale: "en" as const,
    cadence: "daily" as const,
    priority: 2 as const,
    tags: ["z", "a"],
    enabled: false,
    curated: false,
    health: {
      status: "pending" as const,
      lastSuccessAt: null,
      consecutiveFailures: 0,
      totalItemsCount: 0,
    },
    itemCounts: { allTime: 0, last24h: 0 },
  });
  const item = (id: number, sourceId: string, eventId: number | null) => ({
    schemaVersion: 1 as const,
    id,
    sourceId,
    eventId,
    title: { raw: `${id}`, zh: null, en: `${id}` },
    summary: { zh: null, en: null },
    editorNote: { zh: null, en: null },
    editorAnalysis: { zh: null, en: null },
    bodyMd: null,
    author: null,
    url: `https://example.com/${id}`,
    canonicalUrl: `https://example.com/${id}`,
    tags: { capabilities: ["z", "a"], entities: [], topics: [] },
    importance: id,
    tier: "all" as const,
    hkr: null,
    publishedAt: ISO,
    createdAt: ISO,
    enrichedAt: ISO,
    commentaryAt: null,
  });
  const event = (id: number, leadItemId: number, memberItemIds: number[]) => ({
    schemaVersion: 1 as const,
    id,
    leadItemId,
    memberItemIds,
    coverage: memberItemIds.length,
    firstSeenAt: ISO,
    latestMemberAt: ISO,
    canonicalTitle: { zh: `${id}`, en: `${id}` },
    editorNote: { zh: null, en: null },
    editorAnalysis: { zh: null, en: null },
    importance: 80,
    tier: "all" as const,
    hkr: null,
  });
  const newsletter = (id: number, itemIds: number[]) => ({
    schemaVersion: 1 as const,
    format: "daily_column" as const,
    id,
    kind: "daily" as const,
    locale: "en" as const,
    periodStart: ISO,
    periodEnd: "2026-07-15T12:00:00.000Z",
    publishedAt: ISO,
    storyCount: 20,
    itemIds,
    title: null,
    themeTag: null,
    summaryMd: null,
    narrativeMd: null,
    featuredItemIds: [itemIds[0]!],
  });
  const policy = (version: string) => ({
    schemaVersion: 1 as const,
    skillName: "editorial" as const,
    version,
    committedAt: ISO,
  });
  return {
    schemaVersion: 1 as const,
    items: [
      item(10, "z-source", 20),
      item(2, "a-source", 4),
      item(9, "z-source", 20),
      item(3, "a-source", 4),
    ],
    events: [event(20, 10, [10, 9]), event(4, 2, [2, 3])],
    sources: [source("z-source"), source("a-source")],
    newsletters: [newsletter(12, [10, 9]), newsletter(5, [2, 3])],
    policies: [policy("v20"), policy("v03")],
  };
}

describe("canonical JSON bytes", () => {
  test("emit recursive lexical key order and preserve business arrays", () => {
    const value = JSON.parse(
      '{"text":"中文😀é","arr":["z","a"],"a":{"b":2,"__proto__":"safe"},"2":"two","10":"ten"}',
    );
    const bytes = canonicalJsonBytes(value);
    expect(new TextDecoder().decode(bytes)).toBe(
      '{"10":"ten","2":"two","a":{"__proto__":"safe","b":2},"arr":["z","a"],"text":"中文😀é"}\n',
    );
    expect(bytes[0]).not.toBe(0xef);
    expect(bytes.at(-1)).toBe(0x0a);
    expect(bytes.at(-2)).not.toBe(0x0a);
  });

  test("hashes the exact UTF-8 bytes including the one trailing LF", async () => {
    const value = { b: "中文😀é", a: [2, 1] };
    expect(await canonicalSha256(value)).toBe(
      "4813c880f4a3b19eebc4f6c631ce3b7397e5244b55e1c74cb781ae4338a54fa9",
    );
  });

  test("does not normalize Unicode code points", async () => {
    expect(await canonicalSha256({ value: "é" })).not.toBe(
      await canonicalSha256({ value: "é" }),
    );
  });

  test("rejects values JSON.stringify would silently erase or coerce", () => {
    const invalid: unknown[] = [
      undefined,
      BigInt(1),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      () => "hidden",
      Symbol("hidden"),
      new Date(ISO),
      new Map([["a", 1]]),
      new Set([1]),
      Object.create({ inherited: true }),
      { toJSON: () => "hidden" },
      { value: undefined },
      [undefined],
    ];
    for (const value of invalid) {
      expect(() => canonicalJsonBytes(value)).toThrow();
    }
  });

  test("rejects sparse arrays, extra properties, symbols, and accessors", () => {
    const sparse = Array(2);
    sparse[1] = "present";
    const extra = [1] as unknown[] & { private?: string };
    extra.private = "hidden";
    const withSymbol = { visible: true, [Symbol("private")]: "hidden" };
    const accessor = Object.defineProperty({}, "secret", {
      enumerable: true,
      get: () => "hidden",
    });
    for (const value of [sparse, extra, withSymbol, accessor]) {
      expect(() => canonicalJsonBytes(value)).toThrow();
    }
  });

  test("rejects arrays with custom prototypes", () => {
    const polluted = Object.setPrototypeOf([1], { private: "hidden" });
    expect(() => canonicalJsonBytes(polluted)).toThrow(/prototype/i);
  });

  test("rejects direct and indirect cycles", () => {
    const direct: Record<string, unknown> = {};
    direct.self = direct;
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = { a };
    a.b = b;
    expect(() => canonicalJsonBytes(direct)).toThrow(/cycle/i);
    expect(() => canonicalJsonBytes(a)).toThrow(/cycle/i);
  });
});

describe("canonical public state", () => {
  test("sorts only entity collections by stable IDs without mutating input", () => {
    const input = state();
    const before = structuredClone(input);
    const output = new TextDecoder().decode(canonicalPublicStateBytes(input));
    const parsed = JSON.parse(output);

    expect(parsed.items.map((entry: { id: number }) => entry.id)).toEqual([
      2, 3, 9, 10,
    ]);
    expect(parsed.events.map((entry: { id: number }) => entry.id)).toEqual([
      4, 20,
    ]);
    expect(parsed.sources.map((entry: { id: string }) => entry.id)).toEqual([
      "a-source",
      "z-source",
    ]);
    expect(parsed.items[0].tags.capabilities).toEqual(["z", "a"]);
    expect(parsed.sources[0].tags).toEqual(["z", "a"]);
    expect(
      parsed.newsletters.map((entry: { id: number }) => entry.id),
    ).toEqual([5, 12]);
    expect(
      parsed.policies.map((entry: { version: string }) => entry.version),
    ).toEqual(["v03", "v20"]);
    expect(parsed.events[1].memberItemIds).toEqual([10, 9]);
    expect(input).toEqual(before);
  });

  test("hashes canonical state after entity-order normalization", async () => {
    const input = state();
    const reordered = {
      ...input,
      items: [...input.items].reverse(),
      sources: [...input.sources].reverse(),
    };
    expect(await canonicalPublicStateSha256(reordered)).toBe(
      await canonicalPublicStateSha256(input),
    );
  });

  test("rejects duplicate entity IDs instead of source-order tie breaking", () => {
    const input = state();
    input.items = [input.items[0]!, { ...input.items[0]! }];
    expect(() => canonicalPublicStateBytes(input)).toThrow(/duplicate/i);
  });
});
