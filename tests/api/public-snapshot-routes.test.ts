import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { GET as getEventMembers } from "@/app/api/events/[id]/members/route";
import { GET as getPublicDailyByDate } from "@/app/api/public/daily/[date]/route";
import { GET as getPublicDaily } from "@/app/api/public/daily/route";
import { GET as getPublicDailies } from "@/app/api/public/dailies/route";
import { GET as getPublicEventMembers } from "@/app/api/public/events/[id]/members/route";
import { GET as getPublicItem } from "@/app/api/public/items/[id]/route";
import { GET as getPublicSources } from "@/app/api/public/sources/route";
import { GET as getActiveSources } from "@/app/api/sources/active/route";
import { computeEtag } from "@/lib/api/public-helpers";
import { DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE } from "@/lib/event-members/query-defaults";
import { canonicalJsonBytes, sha256Hex } from "@/lib/public-content/canonical";
import {
  manifestSchema,
  snapshotPointerSchema,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import {
  publicEventMembersSnapshotRequestResult,
  publicEventMembersSnapshotResult,
  publicItemSnapshotRequestResult,
  publicItemSnapshotResult,
} from "@/lib/public-content/http";
import {
  CURRENT_POINTER_KEY,
  objectKey,
  releaseManifestKey,
} from "@/lib/public-content/paths";
import { buildPublicRelease } from "@/lib/public-content/publisher/build-release";
import { materializedPageLogicalName } from "@/lib/public-content/materialized-artifact";
import type { PublicEntityChange } from "@/lib/public-content/publisher/types";
import { publicSnapshotReader } from "@/lib/public-content/reader";
import { MemoryPublicSnapshotHttp } from "@/lib/public-content/testing/memory-store";
import { __resetPublicBuckets } from "@/lib/rate-limit/public";
import { checkSourcePublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import { canonicalState } from "../public-content/contract-fixtures";

const ROUTE_SOURCES = [
  "app/api/public/sources/route.ts",
  "app/api/public/items/[id]/route.ts",
  "app/api/public/events/[id]/members/route.ts",
  "app/api/public/daily/route.ts",
  "app/api/public/daily/[date]/route.ts",
  "app/api/public/dailies/route.ts",
  "app/api/events/[id]/members/route.ts",
  "app/api/sources/active/route.ts",
] as const;

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.R2_PUBLIC_BASE_URL;
const stores = new Map<string, MemoryPublicSnapshotHttp>();
let fixture: Awaited<ReturnType<typeof routeFixture>>;

beforeAll(async () => {
  fixture = await routeFixture();
  stores.set(fixture.http.baseUrl, fixture.http);
  const routedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const store = stores.get(url.origin);
    if (!store) throw new Error(`poison network path: ${url.origin}`);
    return store.fetch(input, init);
  };
  globalThis.fetch = Object.assign(routedFetch, {
    preconnect: () => undefined,
  });
  process.env.R2_PUBLIC_BASE_URL = fixture.http.baseUrl;
});

beforeEach(() => {
  __resetPublicBuckets();
  process.env.R2_PUBLIC_BASE_URL = fixture.http.baseUrl;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalBaseUrl === undefined) delete process.env.R2_PUBLIC_BASE_URL;
  else process.env.R2_PUBLIC_BASE_URL = originalBaseUrl;
});

describe("snapshot-backed public JSON routes", () => {
  test("serves the public source catalog with CORS, ETag and 304", async () => {
    const request = publicRequest("/api/public/sources");
    const response = await getPublicSources(request);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("s-maxage=");
    expect(body).toMatchObject({
      total: 1,
      sources: [
        {
          id: "openai-news",
          name_en: "OpenAI Blog",
          enabled: true,
          health: { total_items_count: 42 },
        },
      ],
    });
    expect(
      new Set(
        fixture.http.requests
          .map(({ key }) => key)
          .filter((key) => key.includes("/objects/")),
      ),
    ).toEqual(
      new Set([
        fixture.release.manifest.artifacts["state/sources"]!.key,
      ]),
    );

    const etag = response.headers.get("etag");
    expect(etag).not.toBeNull();
    const notModified = await getPublicSources(
      publicRequest("/api/public/sources", { "if-none-match": etag! }),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
  });

  test("falls back source-shard validation and maps terminal corruption to 503", async () => {
    for (const mode of ["missing", "invalid"] as const) {
      const fallback = await sourcesFallbackFixture(mode, true);
      stores.set(fallback.baseUrl, fallback);
      process.env.R2_PUBLIC_BASE_URL = fallback.baseUrl;

      const response = await getPublicSources(
        publicRequest(`/api/public/sources?case=${mode}`),
      );

      expect(response.status).toBe(200);
      expect((await response.json()).sources[0].name_en).toBe(
        "Previous Source",
      );
    }

    const terminal = await sourcesFallbackFixture("invalid", false);
    stores.set(terminal.baseUrl, terminal);
    process.env.R2_PUBLIC_BASE_URL = terminal.baseUrl;
    const unavailable = await getPublicSources(
      publicRequest("/api/public/sources?case=terminal"),
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "snapshot_unavailable" });
  });

  test("revalidates warm source artifacts before serving last-known-good", async () => {
    const warm = await routeFixture("https://sources-warm-lkg.test");
    stores.set(warm.http.baseUrl, warm.http);
    process.env.R2_PUBLIC_BASE_URL = warm.http.baseUrl;
    const first = await getPublicSources(
      publicRequest("/api/public/sources?case=warm"),
    );
    const firstBody = await first.json();
    expect(first.status).toBe(200);

    warm.http.delete(CURRENT_POINTER_KEY);
    const lastKnownGood = await getPublicSources(
      publicRequest("/api/public/sources?case=lkg"),
    );
    expect(lastKnownGood.status).toBe(200);
    expect(await lastKnownGood.json()).toEqual(firstBody);

    const invalid = await sourcesFallbackFixture(
      "invalid",
      false,
      "unvalidated-lkg",
    );
    stores.set(invalid.baseUrl, invalid);
    process.env.R2_PUBLIC_BASE_URL = invalid.baseUrl;
    expect(
      await publicSnapshotReader().readLogicalArtifact("state/sources"),
    ).not.toBeNull();
    invalid.delete(CURRENT_POINTER_KEY);

    const rejected = await getPublicSources(
      publicRequest("/api/public/sources?case=invalid-lkg"),
    );
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toEqual({ error: "snapshot_unavailable" });
  });

  test("serves only persisted eligible item details and preserves errors", async () => {
    const response = await getPublicItem(publicRequest("/api/public/items/1"), {
      params: Promise.resolve({ id: "1" }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: "1",
      source: { id: "openai-news", name_en: "OpenAI Blog" },
      title: { raw: "Raw title", zh: "标题", en: "Title" },
      hkr: { h: true, k: true, r: false },
      event: { cluster_id: 7, coverage: 2 },
      body_md: "Public, sanitized article markdown",
    });
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("body_rss");

    const emptyBody = await getPublicItem(
      publicRequest("/api/public/items/2"),
      { params: Promise.resolve({ id: "2" }) },
    );
    expect(emptyBody.status).toBe(200);
    expect((await emptyBody.json()).body_md).toBeNull();

    for (const id of ["777", "999999"]) {
      const missing = await getPublicItem(
        publicRequest(`/api/public/items/${id}`),
        { params: Promise.resolve({ id }) },
      );
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "not_found" });
    }
    const invalid = await getPublicItem(publicRequest("/api/public/items/0"), {
      params: Promise.resolve({ id: "0" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_id" });
  });

  test("item detail reads only its release-pinned entity, body, source and event shards", async () => {
    const direct = await routeFixture("https://item-direct-content.test");
    stores.set(direct.http.baseUrl, direct.http);
    process.env.R2_PUBLIC_BASE_URL = direct.http.baseUrl;
    direct.http.delete(
      direct.release.manifest.artifacts["state/policies"]!.key,
    );
    direct.http.clearRequests();

    const response = await getPublicItem(
      publicRequest("/api/public/items/1"),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).body_md).toBe(
      "Public, sanitized article markdown",
    );
    expect(direct.http.requests).toHaveLength(6);
    expect(direct.http.requestCount(CURRENT_POINTER_KEY)).toBe(1);
    expect(requestedObjectKeys(direct.http)).toEqual(
      new Set([
        direct.release.manifest.artifacts["state/items/01"]!.key,
        direct.release.manifest.artifacts["bodies/items/01"]!.key,
        direct.release.manifest.artifacts["state/sources"]!.key,
        direct.release.manifest.artifacts["state/events/07"]!.key,
      ]),
    );
  });

  test("direct item results exactly match the canonical serializer contract", async () => {
    const direct = await routeFixture("https://item-parity-content.test");
    stores.set(direct.http.baseUrl, direct.http);
    process.env.R2_PUBLIC_BASE_URL = direct.http.baseUrl;

    const actual = await publicItemSnapshotRequestResult("1");
    const expected = await publicItemSnapshotResult(
      { state: direct.state, release: resolvedRelease(direct) },
      "1",
      {
        readItemBody: async (_release, id) =>
          direct.state.items.find((item) => item.id === id)?.bodyMd ?? null,
      },
    );

    expect(actual).toEqual(expected);
  });

  test("preserves inline legacy bodies and the existing item ETag signal", async () => {
    const pointer = snapshotPointerSchema.parse({
      schemaVersion: 1,
      active: {
        releaseId: fixture.release.releaseId,
        manifestKey: releaseManifestKey(fixture.release.releaseId),
        manifestSha256: fixture.release.manifestSha256,
      },
      previous: null,
      publishedAt: "2026-07-14T12:00:00.000Z",
      sourceWatermark: fixture.release.manifest.sourceWatermark,
    });
    const release = {
      ref: pointer.active,
      manifest: fixture.release.manifest,
      pointer,
      source: "active" as const,
    };
    const inlineState: CanonicalPublicState = canonicalState();
    inlineState.sources[0] = { ...inlineState.sources[0]!, enabled: true };
    inlineState.items[1] = { ...inlineState.items[1]!, bodyMd: null };
    const splitState = {
      ...inlineState,
      items: inlineState.items.map((item) => ({ ...item, bodyMd: null })),
    };
    let bodyReads = 0;
    const reader = {
      readItemBody: async (pinnedRelease: typeof release, id: number) => {
        expect(pinnedRelease).toBe(release);
        bodyReads += 1;
        return id === 1 ? inlineState.items[0]!.bodyMd : null;
      },
    };

    const inline = await publicItemSnapshotResult(
      { state: inlineState, release },
      "1",
      reader,
    );
    const split = await publicItemSnapshotResult(
      { state: splitState, release },
      "1",
      reader,
    );
    const empty = await publicItemSnapshotResult(
      { state: splitState, release },
      "2",
      reader,
    );

    expect(inline).toMatchObject({
      ok: true,
      body: { body_md: "Public, sanitized article markdown" },
    });
    expect(split).toMatchObject({
      ok: true,
      body: { body_md: "Public, sanitized article markdown" },
    });
    expect(empty).toMatchObject({ ok: true, body: { body_md: null } });
    expect(bodyReads).toBe(2);
    expect(inline.ok).toBeTrue();
    expect(split.ok).toBeTrue();
    if (!inline.ok || !split.ok) throw new Error("expected item results");
    expect(inline.signal).toBe(split.signal);
  });

  test("preserves public and UI event-member locale/envelope contracts", async () => {
    const publicResponse = await getPublicEventMembers(
      publicRequest("/api/public/events/7/members"),
      { params: Promise.resolve({ id: "7" }) },
    );
    const publicBody = await publicResponse.json();
    expect(publicBody.cluster_id).toBe(7);
    expect(publicBody.total).toBe(2);
    expect(publicBody.members[0]).toMatchObject({
      source_name: "OpenAI Blog",
      title: "Title",
    });

    const uiResponse = await getEventMembers(
      publicRequest("/api/events/7/members"),
      { params: Promise.resolve({ id: "7" }) },
    );
    const uiBody = await uiResponse.json();
    expect(uiBody.total).toBe(2);
    expect(uiBody.members[0]).toMatchObject({
      source_name: "OpenAI 博客",
      title: "标题",
    });
    expect(uiBody).not.toHaveProperty("cluster_id");

    const unknown = await getPublicEventMembers(
      publicRequest("/api/public/events/999/members?locale=zh"),
      { params: Promise.resolve({ id: "999" }) },
    );
    expect(await unknown.json()).toEqual({ cluster_id: 999, members: [], total: 0 });
    const invalid = await getPublicEventMembers(
      publicRequest("/api/public/events/7/members?locale=ja"),
      { params: Promise.resolve({ id: "7" }) },
    );
    expect(invalid.status).toBe(400);
  });

  test("event members read one event shard and only distinct member item buckets", async () => {
    const direct = await routeFixture("https://event-direct-content.test");
    stores.set(direct.http.baseUrl, direct.http);
    process.env.R2_PUBLIC_BASE_URL = direct.http.baseUrl;
    direct.http.delete(
      direct.release.manifest.artifacts["state/policies"]!.key,
    );
    direct.http.clearRequests();

    const response = await getPublicEventMembers(
      publicRequest("/api/public/events/7/members?locale=en"),
      { params: Promise.resolve({ id: "7" }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).total).toBe(2);
    expect(direct.http.requests).toHaveLength(6);
    expect(direct.http.requestCount(CURRENT_POINTER_KEY)).toBe(1);
    expect(requestedObjectKeys(direct.http)).toEqual(
      new Set([
        direct.release.manifest.artifacts["state/events/07"]!.key,
        direct.release.manifest.artifacts["state/items/01"]!.key,
        direct.release.manifest.artifacts["state/items/02"]!.key,
        direct.release.manifest.artifacts["state/sources"]!.key,
      ]),
    );
  });

  test("direct event results exactly match both canonical envelope contracts", async () => {
    const direct = await routeFixture("https://event-parity-content.test");
    stores.set(direct.http.baseUrl, direct.http);
    process.env.R2_PUBLIC_BASE_URL = direct.http.baseUrl;

    for (const listOnly of [false, true]) {
      const req = publicRequest("/api/public/events/7/members?locale=en");
      const options = {
        rawId: "7",
        defaultLocale: DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE,
        listOnly,
      } as const;
      const actual = await publicEventMembersSnapshotRequestResult(req, options);
      const expected = publicEventMembersSnapshotResult(
        { state: direct.state, release: resolvedRelease(direct) },
        req,
        options,
      );
      expect(actual).toEqual(expected);
    }
  });

  test("event member item reads deduplicate IDs that share one bucket", async () => {
    const state: CanonicalPublicState = canonicalState();
    state.items[1] = { ...state.items[1]!, id: 129, eventId: 7 };
    state.events[0] = {
      ...state.events[0]!,
      memberItemIds: [1, 129],
    };
    state.newsletters = [];
    const direct = await routeFixture(
      "https://event-same-bucket-content.test",
      state,
    );
    stores.set(direct.http.baseUrl, direct.http);
    process.env.R2_PUBLIC_BASE_URL = direct.http.baseUrl;
    direct.http.clearRequests();

    const response = await getPublicEventMembers(
      publicRequest("/api/public/events/7/members?locale=en"),
      { params: Promise.resolve({ id: "7" }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).total).toBe(2);
    expect(requestedObjectKeys(direct.http)).toEqual(
      new Set([
        direct.release.manifest.artifacts["state/events/07"]!.key,
        direct.release.manifest.artifacts["state/items/01"]!.key,
        direct.release.manifest.artifacts["state/sources"]!.key,
      ]),
    );
  });

  test("legacy manifests keep exact item/event behavior through scoped canonical fallback", async () => {
    const legacy = await routeFixture("https://legacy-direct-content.test");
    const policyArtifact = legacy.release.artifacts.find(
      ({ logicalName }) => logicalName === "state/policies",
    )!;
    legacy.http.put(policyArtifact.descriptor.key, policyArtifact.bytes);
    const legacyManifestValue = { ...legacy.release.manifest };
    delete legacyManifestValue.numericShardCount;
    const manifest = manifestSchema.parse(legacyManifestValue);
    const manifestBytes = canonicalJsonBytes(manifest);
    const pointer = snapshotPointerSchema.parse({
      ...legacy.pointer,
      active: {
        ...legacy.pointer.active,
        manifestSha256: await sha256Hex(manifestBytes),
      },
    });
    legacy.http.put(pointer.active.manifestKey, manifestBytes);
    legacy.http.put(CURRENT_POINTER_KEY, canonicalJsonBytes(pointer));
    legacy.http.clearRequests();
    stores.set(legacy.http.baseUrl, legacy.http);
    process.env.R2_PUBLIC_BASE_URL = legacy.http.baseUrl;
    const release = {
      ref: pointer.active,
      manifest,
      pointer,
      source: "active" as const,
    };

    const itemResponse = await getPublicItem(
      publicRequest("/api/public/items/1"),
      { params: Promise.resolve({ id: "1" }) },
    );
    const expectedItem = await publicItemSnapshotResult(
      { state: legacy.state, release },
      "1",
      { readItemBody: async () => legacy.state.items[0]!.bodyMd },
    );
    expect(expectedItem.ok).toBeTrue();
    if (!expectedItem.ok) throw new Error("expected legacy item result");
    expect(await itemResponse.json()).toEqual(expectedItem.body);
    expect(requestedObjectKeys(legacy.http)).toEqual(
      new Set([
        ...Object.entries(manifest.artifacts)
          .filter(([logicalName]) => logicalName.startsWith("state/"))
          .map(([, descriptor]) => descriptor.key),
        manifest.artifacts["bodies/items/01"]!.key,
      ]),
    );

    legacy.http.clearRequests();
    const eventReq = publicRequest("/api/public/events/7/members?locale=en");
    const eventResponse = await getPublicEventMembers(eventReq, {
      params: Promise.resolve({ id: "7" }),
    });
    const expectedEvent = publicEventMembersSnapshotResult(
      { state: legacy.state, release },
      eventReq,
      {
        rawId: "7",
        defaultLocale: DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE,
      },
    );
    expect(expectedEvent.ok).toBeTrue();
    if (!expectedEvent.ok) throw new Error("expected legacy event result");
    expect(await eventResponse.json()).toEqual(expectedEvent.body);
  });

  test("direct item consistency failure retries the whole operation on previous", async () => {
    const fallback = await directItemFallbackFixture();
    stores.set(fallback.http.baseUrl, fallback.http);
    process.env.R2_PUBLIC_BASE_URL = fallback.http.baseUrl;

    const response = await getPublicItem(
      publicRequest("/api/public/items/1"),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "1",
      source: { id: "openai-news" },
      title: { en: "Title" },
    });
  });

  test("direct item reads serve a warm last-known-good release", async () => {
    const warm = await routeFixture("https://item-warm-lkg-content.test");
    stores.set(warm.http.baseUrl, warm.http);
    process.env.R2_PUBLIC_BASE_URL = warm.http.baseUrl;
    const first = await publicItemSnapshotRequestResult("1");
    warm.http.delete(CURRENT_POINTER_KEY);

    const fallback = await publicItemSnapshotRequestResult("1");

    expect(fallback).toEqual(first);
  });

  test("event consistency failures retry both envelopes against the previous whole release", async () => {
    for (const mode of [
      "missing-member",
      "mismatched-event",
      "missing-source",
    ] as const) {
      const fallback = await directEventFallbackFixture(mode);
      stores.set(fallback.http.baseUrl, fallback.http);
      process.env.R2_PUBLIC_BASE_URL = fallback.http.baseUrl;
      const publicReq = publicRequest(
        `/api/public/events/7/members?locale=en&case=${mode}`,
      );
      const options = {
        rawId: "7",
        defaultLocale: DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE,
      } as const;
      const expected = publicEventMembersSnapshotResult(
        {
          state: fallback.previousState,
          release: fallback.previousRelease,
        },
        publicReq,
        options,
      );
      expect(expected.ok).toBeTrue();
      if (!expected.ok) throw new Error("expected previous event result");

      const publicResponse = await getPublicEventMembers(publicReq, {
        params: Promise.resolve({ id: "7" }),
      });
      expect(publicResponse.status).toBe(200);
      expect(await publicResponse.json()).toEqual(expected.body);
      expect(publicResponse.headers.get("etag")).toBe(
        computeEtag("public-event", expected.signal),
      );

      const legacyReq = publicRequest(
        `/api/events/7/members?locale=en&case=${mode}`,
      );
      const expectedLegacy = publicEventMembersSnapshotResult(
        {
          state: fallback.previousState,
          release: fallback.previousRelease,
        },
        legacyReq,
        { ...options, listOnly: true },
      );
      expect(expectedLegacy.ok).toBeTrue();
      if (!expectedLegacy.ok) {
        throw new Error("expected previous legacy event result");
      }
      const legacyResponse = await getEventMembers(legacyReq, {
        params: Promise.resolve({ id: "7" }),
      });
      expect(legacyResponse.status).toBe(200);
      expect(await legacyResponse.json()).toEqual(expectedLegacy.body);
    }
  });

  test("valid empty direct shards preserve item and event not-found semantics", async () => {
    const emptyItem = await routeFixture("https://item-empty-shard.test");
    const emptyItemRelease = await replaceActiveArtifact(
      emptyItem,
      "state/items/01",
      {
        schemaVersion: 1,
        entityType: "item",
        shard: { kind: "id_bucket", bucket: "01" },
        entities: [],
      },
    );
    stores.set(emptyItem.http.baseUrl, emptyItem.http);
    process.env.R2_PUBLIC_BASE_URL = emptyItem.http.baseUrl;
    emptyItem.http.clearRequests();

    const itemResponse = await getPublicItem(
      publicRequest("/api/public/items/1?case=empty"),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(itemResponse.status).toBe(404);
    expect(await itemResponse.json()).toEqual({ error: "not_found" });
    expect(emptyItem.http.requests).toHaveLength(3);
    expect(requestedObjectKeys(emptyItem.http)).toEqual(
      new Set([
        emptyItemRelease.manifest.artifacts["state/items/01"]!.key,
      ]),
    );

    const emptyEvent = await routeFixture("https://event-empty-shard.test");
    const emptyEventRelease = await replaceActiveArtifact(
      emptyEvent,
      "state/events/07",
      {
        schemaVersion: 1,
        entityType: "event",
        shard: { kind: "id_bucket", bucket: "07" },
        entities: [],
      },
    );
    stores.set(emptyEvent.http.baseUrl, emptyEvent.http);
    process.env.R2_PUBLIC_BASE_URL = emptyEvent.http.baseUrl;
    emptyEvent.http.clearRequests();
    const eventReq = publicRequest(
      "/api/public/events/7/members?locale=en&case=empty",
    );
    const eventResponse = await getPublicEventMembers(eventReq, {
      params: Promise.resolve({ id: "7" }),
    });
    const expectedState: CanonicalPublicState = {
      ...emptyEvent.state,
      events: emptyEvent.state.events.filter(({ id }) => id !== 7),
      items: emptyEvent.state.items.map((item) =>
        item.eventId === 7 ? { ...item, eventId: null } : item,
      ),
    };
    const expectedEvent = publicEventMembersSnapshotResult(
      {
        state: expectedState,
        release: emptyEventRelease,
      },
      eventReq,
      {
        rawId: "7",
        defaultLocale: DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE,
      },
    );
    expect(expectedEvent.ok).toBeTrue();
    if (!expectedEvent.ok) throw new Error("expected empty event result");
    expect(eventResponse.status).toBe(200);
    expect(await eventResponse.json()).toEqual(expectedEvent.body);
    expect(eventResponse.headers.get("etag")).toBe(
      computeEtag("public-event", expectedEvent.signal),
    );
    expect(emptyEvent.http.requests).toHaveLength(3);
    expect(requestedObjectKeys(emptyEvent.http)).toEqual(
      new Set([
        emptyEventRelease.manifest.artifacts["state/events/07"]!.key,
      ]),
    );
  });

  test("missing direct item and event dependencies fail closed with controlled 503", async () => {
    const item = await routeFixture("https://item-terminal-shard.test");
    stores.set(item.http.baseUrl, item.http);
    process.env.R2_PUBLIC_BASE_URL = item.http.baseUrl;
    item.http.delete(item.release.manifest.artifacts["bodies/items/01"]!.key);
    const itemResponse = await getPublicItem(
      publicRequest("/api/public/items/1?case=terminal"),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(itemResponse.status).toBe(503);
    expect(await itemResponse.json()).toEqual({ error: "snapshot_unavailable" });

    const corruptItem = await routeFixture(
      "https://item-corrupt-shard.test",
    );
    stores.set(corruptItem.http.baseUrl, corruptItem.http);
    process.env.R2_PUBLIC_BASE_URL = corruptItem.http.baseUrl;
    corruptItem.http.put(
      corruptItem.release.manifest.artifacts["state/items/01"]!.key,
      canonicalJsonBytes({ invalid: true }),
    );
    const corruptItemResponse = await getPublicItem(
      publicRequest("/api/public/items/1?case=corrupt"),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(corruptItemResponse.status).toBe(503);
    expect(await corruptItemResponse.json()).toEqual({
      error: "snapshot_unavailable",
    });

    const corruptEvent = await routeFixture(
      "https://event-corrupt-shard.test",
    );
    stores.set(corruptEvent.http.baseUrl, corruptEvent.http);
    process.env.R2_PUBLIC_BASE_URL = corruptEvent.http.baseUrl;
    corruptEvent.http.put(
      corruptEvent.release.manifest.artifacts["state/events/07"]!.key,
      canonicalJsonBytes({ invalid: true }),
    );
    const corruptEventResponse = await getPublicEventMembers(
      publicRequest("/api/public/events/7/members?locale=en&case=corrupt"),
      { params: Promise.resolve({ id: "7" }) },
    );
    expect(corruptEventResponse.status).toBe(503);
    expect(await corruptEventResponse.json()).toEqual({
      error: "snapshot_unavailable",
    });

    const event = await routeFixture("https://event-terminal-shard.test");
    stores.set(event.http.baseUrl, event.http);
    process.env.R2_PUBLIC_BASE_URL = event.http.baseUrl;
    event.http.delete(event.release.manifest.artifacts["state/sources"]!.key);
    const publicEvent = await getPublicEventMembers(
      publicRequest("/api/public/events/7/members?locale=en&case=terminal"),
      { params: Promise.resolve({ id: "7" }) },
    );
    expect(publicEvent.status).toBe(503);
    expect(await publicEvent.json()).toEqual({
      error: "snapshot_unavailable",
    });
    const legacyEvent = await getEventMembers(
      publicRequest("/api/events/7/members?locale=en&case=terminal"),
      { params: Promise.resolve({ id: "7" }) },
    );
    expect(legacyEvent.status).toBe(503);
    expect(await legacyEvent.json()).toEqual({
      error: "snapshot_unavailable",
    });
  });

  test("rejects invalid item/event parameters before any snapshot read", async () => {
    const direct = await routeFixture("https://direct-validation-content.test");
    stores.set(direct.http.baseUrl, direct.http);
    process.env.R2_PUBLIC_BASE_URL = direct.http.baseUrl;
    direct.http.clearRequests();

    const item = await getPublicItem(publicRequest("/api/public/items/0"), {
      params: Promise.resolve({ id: "0" }),
    });
    const event = await getPublicEventMembers(
      publicRequest("/api/public/events/7/members?locale=ja"),
      { params: Promise.resolve({ id: "7" }) },
    );

    expect(item.status).toBe(400);
    expect(event.status).toBe(400);
    expect(direct.http.requests).toHaveLength(0);
  });

  test("serves latest, dated and indexed daily columns with validation", async () => {
    fixture.http.clearRequests();
    const latest = await getPublicDaily(publicRequest("/api/public/daily"));
    expect(await latest.json()).toMatchObject({
      id: 4,
      date: "2026-07-14",
      title: "今日 AI",
      story_count: 2,
    });

    const dated = await getPublicDailyByDate(
      publicRequest("/api/public/daily/2026-07-14"),
      { params: Promise.resolve({ date: "2026-07-14" }) },
    );
    expect(dated.status).toBe(200);
    expect((await dated.json()).date).toBe("2026-07-14");

    const missing = await getPublicDailyByDate(
      publicRequest("/api/public/daily/2026-07-13"),
      { params: Promise.resolve({ date: "2026-07-13" }) },
    );
    expect(missing.status).toBe(404);
    const invalid = await getPublicDailyByDate(
      publicRequest("/api/public/daily/2026-02-30"),
      { params: Promise.resolve({ date: "2026-02-30" }) },
    );
    expect(invalid.status).toBe(400);

    const index = await getPublicDailies(
      publicRequest("/api/public/dailies?take=1&locale=zh"),
    );
    expect(await index.json()).toEqual({
      count: 1,
      items: [
        {
          id: 4,
          date: "2026-07-14",
          generated_at: "2026-07-14T12:00:00.000Z",
          title: "今日 AI",
          theme_tag: "模型进展",
          story_count: 2,
        },
      ],
    });
    const invalidIndex = await getPublicDailies(
      publicRequest("/api/public/dailies?take=0"),
    );
    expect(invalidIndex.status).toBe(400);
    expect(requestedObjectKeys(fixture.http)).toEqual(
      new Set([
        fixture.release.manifest.artifacts[
          materializedPageLogicalName.daily("zh")
        ]!.key,
      ]),
    );
  });

  test("serves the active source picker from the same snapshot", async () => {
    const response = await getActiveSources();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sources: [
        {
          id: "openai-news",
          name_en: "OpenAI Blog",
          name_zh: "OpenAI 博客",
          kind: "rss",
          group: "vendor-official",
          locale: "en",
        },
      ],
      total: 1,
    });
  });

  test("maps cold reader failure to controlled 503 on public and UI routes", async () => {
    const unavailable = new MemoryPublicSnapshotHttp(
      "https://unavailable-content.test",
    );
    stores.set(unavailable.baseUrl, unavailable);
    process.env.R2_PUBLIC_BASE_URL = unavailable.baseUrl;

    const publicResponse = await getPublicSources(
      publicRequest("/api/public/sources"),
    );
    expect(publicResponse.status).toBe(503);
    expect(await publicResponse.json()).toEqual({ error: "snapshot_unavailable" });
    expect(publicResponse.headers.get("access-control-allow-origin")).toBe("*");

    const uiResponse = await getActiveSources();
    expect(uiResponse.status).toBe(503);
    expect(await uiResponse.json()).toEqual({ error: "snapshot_unavailable" });
  });

  test("all migrated route graphs are recursively free of DB dependencies", () => {
    const boundary = checkSourcePublicDbBoundary({
      rootDir: process.cwd(),
      entrypointSources: ROUTE_SOURCES,
    });
    expect(boundary.ok).toBeTrue();
    expect(boundary.violations).toHaveLength(0);
  });
});

function publicRequest(
  path: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://newsroom.test${path}`, { headers });
}

function requestedObjectKeys(http: MemoryPublicSnapshotHttp): Set<string> {
  return new Set(
    http.requests
      .map(({ key }) => key)
      .filter((key) => key.includes("/objects/")),
  );
}

async function routeFixture(
  baseUrl?: string,
  inputState?: CanonicalPublicState,
) {
  const state: CanonicalPublicState = inputState ?? canonicalState();
  state.sources[0] = { ...state.sources[0]!, enabled: true };
  state.items[1] = { ...state.items[1]!, bodyMd: null };
  const release = await buildPublicRelease({
    previousManifest: null,
    sourceWatermark: 10,
    changes: allChanges(state),
    generatedAtMs: Date.parse("2026-07-14T12:00:00.000Z"),
    loadArtifact: async () => {
      throw new Error("fixture cannot load a prior artifact");
    },
  });
  const http = new MemoryPublicSnapshotHttp(baseUrl);
  for (const artifact of release.artifacts) {
    http.put(artifact.descriptor.key, artifact.bytes);
  }
  // PCR-5 guard: daily and active-source reads must not aggregate unrelated
  // canonical state.
  http.delete(release.manifest.artifacts["state/policies"]!.key);
  const manifestKey = releaseManifestKey(release.releaseId);
  http.put(manifestKey, release.manifestBytes);
  const pointer = snapshotPointerSchema.parse({
    schemaVersion: 1,
    active: {
      releaseId: release.releaseId,
      manifestKey,
      manifestSha256: release.manifestSha256,
    },
    previous: null,
    publishedAt: "2026-07-14T12:00:00.000Z",
    sourceWatermark: 10,
  });
  http.put(CURRENT_POINTER_KEY, canonicalJsonBytes(pointer));
  return { http, pointer, release, state };
}

function resolvedRelease(
  fixture: Awaited<ReturnType<typeof routeFixture>>,
) {
  return {
    ref: fixture.pointer.active,
    manifest: fixture.release.manifest,
    pointer: fixture.pointer,
    source: "active" as const,
  };
}

async function replaceActiveArtifact(
  fixture: Awaited<ReturnType<typeof routeFixture>>,
  logicalName: string,
  value: unknown,
) {
  const priorDescriptor = fixture.release.manifest.artifacts[logicalName];
  if (!priorDescriptor) {
    throw new Error(`fixture artifact is missing: ${logicalName}`);
  }
  const bytes = canonicalJsonBytes(value);
  const sha256 = await sha256Hex(bytes);
  const descriptor = {
    ...priorDescriptor,
    key: objectKey(sha256, "json"),
    sha256,
    byteLength: bytes.byteLength,
  };
  const manifest = manifestSchema.parse({
    ...fixture.release.manifest,
    artifacts: {
      ...fixture.release.manifest.artifacts,
      [logicalName]: descriptor,
    },
  });
  const manifestBytes = canonicalJsonBytes(manifest);
  const pointer = snapshotPointerSchema.parse({
    ...fixture.pointer,
    active: {
      ...fixture.pointer.active,
      manifestSha256: await sha256Hex(manifestBytes),
    },
  });
  fixture.http.put(descriptor.key, bytes);
  fixture.http.put(pointer.active.manifestKey, manifestBytes);
  fixture.http.put(CURRENT_POINTER_KEY, canonicalJsonBytes(pointer));
  return {
    ref: pointer.active,
    manifest,
    pointer,
    source: "active" as const,
  };
}

async function directEventFallbackFixture(
  mode: "missing-member" | "mismatched-event" | "missing-source",
) {
  const previousState: CanonicalPublicState = canonicalState();
  previousState.sources[0] = { ...previousState.sources[0]!, enabled: true };
  const previous = await buildPublicRelease({
    previousManifest: null,
    sourceWatermark: 9,
    changes: allChanges(previousState),
    loadArtifact: async () => {
      throw new Error("fixture cannot load a prior artifact");
    },
  });
  const objectBytes = new Map(
    previous.artifacts.map(({ descriptor, bytes }) => [descriptor.key, bytes]),
  );
  const changes: PublicEntityChange[] = [];
  if (mode === "missing-member") {
    const event = previousState.events.find(({ id }) => id === 7)!;
    changes.push({
      entityType: "event",
      entityKey: String(event.id),
      value: {
        ...event,
        memberItemIds: [...event.memberItemIds, 999],
        coverage: new Set([...event.memberItemIds, 999]).size,
      },
    });
  } else {
    const item = previousState.items.find(({ id }) => id === 1)!;
    changes.push({
      entityType: "item",
      entityKey: String(item.id),
      value:
        mode === "mismatched-event"
          ? { ...item, eventId: null }
          : { ...item, sourceId: "missing-source" },
    });
  }
  const active = await buildPublicRelease({
    previousManifest: previous.manifest,
    sourceWatermark: 10,
    changes,
    loadArtifact: async (_logicalName, descriptor) => {
      const bytes = objectBytes.get(descriptor.key);
      if (!bytes) throw new Error(`missing fixture object: ${descriptor.key}`);
      return bytes;
    },
  });
  for (const artifact of active.artifacts) {
    objectBytes.set(artifact.descriptor.key, artifact.bytes);
  }
  const http = new MemoryPublicSnapshotHttp(
    `https://event-${mode}-fallback.test`,
  );
  for (const [key, bytes] of objectBytes) http.put(key, bytes);
  const previousManifestKey = releaseManifestKey(previous.releaseId);
  const activeManifestKey = releaseManifestKey(active.releaseId);
  http.put(previousManifestKey, previous.manifestBytes);
  http.put(activeManifestKey, active.manifestBytes);
  const pointer = snapshotPointerSchema.parse({
    schemaVersion: 1,
    active: {
      releaseId: active.releaseId,
      manifestKey: activeManifestKey,
      manifestSha256: active.manifestSha256,
    },
    previous: {
      releaseId: previous.releaseId,
      manifestKey: previousManifestKey,
      manifestSha256: previous.manifestSha256,
    },
    publishedAt: "2026-07-14T12:00:00.000Z",
    sourceWatermark: 10,
  });
  http.put(CURRENT_POINTER_KEY, canonicalJsonBytes(pointer));
  return {
    active,
    http,
    pointer,
    previous,
    previousState,
    previousRelease: {
      ref: pointer.previous!,
      manifest: previous.manifest,
      pointer,
      source: "previous" as const,
    },
  };
}

async function directItemFallbackFixture() {
  const previousState: CanonicalPublicState = canonicalState();
  previousState.sources[0] = { ...previousState.sources[0]!, enabled: true };
  const previous = await buildPublicRelease({
    previousManifest: null,
    sourceWatermark: 9,
    changes: allChanges(previousState),
    loadArtifact: async () => {
      throw new Error("fixture cannot load a prior artifact");
    },
  });
  const objectBytes = new Map(
    previous.artifacts.map(({ descriptor, bytes }) => [descriptor.key, bytes]),
  );
  const danglingItem = {
    ...previousState.items[0]!,
    sourceId: "missing-source",
    title: { ...previousState.items[0]!.title, en: "Invalid active title" },
  };
  const active = await buildPublicRelease({
    previousManifest: previous.manifest,
    sourceWatermark: 10,
    changes: [
      {
        entityType: "item",
        entityKey: String(danglingItem.id),
        value: danglingItem,
      },
    ],
    loadArtifact: async (_logicalName, descriptor) => {
      const bytes = objectBytes.get(descriptor.key);
      if (!bytes) throw new Error(`missing fixture object: ${descriptor.key}`);
      return bytes;
    },
  });
  for (const artifact of active.artifacts) {
    objectBytes.set(artifact.descriptor.key, artifact.bytes);
  }
  const http = new MemoryPublicSnapshotHttp(
    "https://item-previous-fallback-content.test",
  );
  for (const [key, bytes] of objectBytes) http.put(key, bytes);
  http.put(releaseManifestKey(previous.releaseId), previous.manifestBytes);
  http.put(releaseManifestKey(active.releaseId), active.manifestBytes);
  http.put(
    CURRENT_POINTER_KEY,
    canonicalJsonBytes(
      snapshotPointerSchema.parse({
        schemaVersion: 1,
        active: {
          releaseId: active.releaseId,
          manifestKey: releaseManifestKey(active.releaseId),
          manifestSha256: active.manifestSha256,
        },
        previous: {
          releaseId: previous.releaseId,
          manifestKey: releaseManifestKey(previous.releaseId),
          manifestSha256: previous.manifestSha256,
        },
        publishedAt: "2026-07-14T12:00:00.000Z",
        sourceWatermark: 10,
      }),
    ),
  );
  return { active, http, previous };
}

async function sourcesFallbackFixture(
  mode: "missing" | "invalid",
  withPrevious: boolean,
  label = withPrevious ? "fallback" : "terminal",
): Promise<MemoryPublicSnapshotHttp> {
  const previousState: CanonicalPublicState = canonicalState();
  previousState.sources[0] = {
    ...previousState.sources[0]!,
    enabled: true,
    name: { zh: "上一个来源", en: "Previous Source" },
  };
  const activeState: CanonicalPublicState = canonicalState();
  activeState.sources[0] = {
    ...activeState.sources[0]!,
    enabled: true,
    name: { zh: "当前来源", en: "Active Source" },
  };
  const [previous, active] = await Promise.all([
    buildPublicRelease({
      previousManifest: null,
      sourceWatermark: 9,
      changes: allChanges(previousState),
      generatedAtMs: Date.parse("2026-07-14T11:00:00.000Z"),
      loadArtifact: async () => {
        throw new Error("fixture cannot load a prior artifact");
      },
    }),
    buildPublicRelease({
      previousManifest: null,
      sourceWatermark: 10,
      changes: allChanges(activeState),
      generatedAtMs: Date.parse("2026-07-14T12:00:00.000Z"),
      loadArtifact: async () => {
        throw new Error("fixture cannot load a prior artifact");
      },
    }),
  ]);
  const store = new MemoryPublicSnapshotHttp(
    `https://sources-${mode}-${label}.test`,
  );
  for (const release of [previous, active]) {
    for (const artifact of release.artifacts) {
      store.put(artifact.descriptor.key, artifact.bytes);
    }
  }
  const previousManifestKey = releaseManifestKey(previous.releaseId);
  store.put(previousManifestKey, previous.manifestBytes);

  const activeArtifacts = { ...active.manifest.artifacts };
  if (mode === "missing") {
    delete activeArtifacts["state/sources"];
  } else {
    const invalidBytes = canonicalJsonBytes({ invalid: true });
    const sha256 = await sha256Hex(invalidBytes);
    const descriptor = activeArtifacts["state/sources"]!;
    activeArtifacts["state/sources"] = {
      ...descriptor,
      key: objectKey(sha256, "json"),
      sha256,
      byteLength: invalidBytes.byteLength,
    };
    store.put(objectKey(sha256, "json"), invalidBytes);
  }
  const activeManifest = manifestSchema.parse({
    ...active.manifest,
    artifacts: activeArtifacts,
  });
  const activeManifestBytes = canonicalJsonBytes(activeManifest);
  const activeManifestSha256 = await sha256Hex(activeManifestBytes);
  const activeManifestKey = releaseManifestKey(active.releaseId);
  store.put(activeManifestKey, activeManifestBytes);
  store.put(
    CURRENT_POINTER_KEY,
    canonicalJsonBytes(
      snapshotPointerSchema.parse({
        schemaVersion: 1,
        active: {
          releaseId: active.releaseId,
          manifestKey: activeManifestKey,
          manifestSha256: activeManifestSha256,
        },
        previous: withPrevious
          ? {
              releaseId: previous.releaseId,
              manifestKey: previousManifestKey,
              manifestSha256: previous.manifestSha256,
            }
          : null,
        publishedAt: "2026-07-14T12:00:00.000Z",
        sourceWatermark: 10,
      }),
    ),
  );
  return store;
}

function allChanges(state: CanonicalPublicState): PublicEntityChange[] {
  return [
    ...state.sources.map((value) => ({
      entityType: "source" as const,
      entityKey: value.id,
      value,
    })),
    ...state.items.map((value) => ({
      entityType: "item" as const,
      entityKey: String(value.id),
      value,
    })),
    ...state.events.map((value) => ({
      entityType: "event" as const,
      entityKey: String(value.id),
      value,
    })),
    ...state.newsletters.map((value) => ({
      entityType: "newsletter" as const,
      entityKey: String(value.id),
      value,
    })),
    ...state.policies.map((value) => ({
      entityType: "policy" as const,
      entityKey: value.skillName,
      value,
    })),
  ];
}
