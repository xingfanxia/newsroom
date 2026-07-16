import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { GET as getPublicFeed } from "@/app/api/public/feed/route";
import { GET as getPublicSearch } from "@/app/api/public/search/route";
import { GET as getOpenApi } from "@/app/openapi.yaml/route";
import { GET as getSkill } from "@/app/skill.md/route";
import { computeEtag, etagSignal } from "@/lib/api/public-helpers";
import { canonicalJsonBytes, sha256Hex } from "@/lib/public-content/canonical";
import {
  manifestSchema,
  publicEntityShardLogicalName,
  snapshotPointerSchema,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import {
  CURRENT_POINTER_KEY,
  objectKey,
  releaseManifestKey,
} from "@/lib/public-content/paths";
import { buildPublicRelease } from "@/lib/public-content/publisher/build-release";
import type { PublicEntityChange } from "@/lib/public-content/publisher/types";
import { publicLexicalShardLogicalName } from "@/lib/public-content/lexical-search-artifacts";
import { MemoryPublicSnapshotHttp } from "@/lib/public-content/testing/memory-store";
import { __resetPublicBuckets } from "@/lib/rate-limit/public";
import { PUBLIC_SEMANTIC_SEARCH_ERROR } from "@/lib/search/query-defaults";
import { checkSourcePublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import {
  EXPECTED_QUERY_IDS,
  PARITY_STATE,
} from "../public-content/fixtures/parity-corpus";

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.R2_PUBLIC_BASE_URL;
let http: MemoryPublicSnapshotHttp;
let primaryHttp: MemoryPublicSnapshotHttp;

beforeAll(async () => {
  primaryHttp = await feedSearchFixture();
  http = primaryHttp;
  const routedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.origin !== http.baseUrl) {
      throw new Error(`poison network/embedding path: ${url.origin}`);
    }
    return http.fetch(input, init);
  };
  globalThis.fetch = Object.assign(routedFetch, {
    preconnect: () => undefined,
  });
  process.env.R2_PUBLIC_BASE_URL = http.baseUrl;
});

beforeEach(() => {
  __resetPublicBuckets();
  http = primaryHttp;
  process.env.R2_PUBLIC_BASE_URL = http.baseUrl;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalBaseUrl === undefined) delete process.env.R2_PUBLIC_BASE_URL;
  else process.env.R2_PUBLIC_BASE_URL = originalBaseUrl;
});

describe("snapshot-backed public feed and lexical search", () => {
  test("preserves tier, source, curation, tag, date and range filters", async () => {
    const cases: Array<[string, number[]]> = [
      ["tier=all&limit=100", EXPECTED_QUERY_IDS.all],
      ["tier=featured&limit=100", EXPECTED_QUERY_IDS.featured],
      ["tier=p1&limit=100", EXPECTED_QUERY_IDS.p1],
      [
        "tier=all&source_id=beta-x&source_group=podcast&source_kind=rss&limit=100",
        EXPECTED_QUERY_IDS.sourcePrecedence,
      ],
      ["tier=all&curated_only=true&limit=100", EXPECTED_QUERY_IDS.curated],
      [
        "tier=all&include_source_tags=preferred&limit=100",
        EXPECTED_QUERY_IDS.includePreferred,
      ],
      [
        "tier=all&exclude_source_tags=blocked&limit=100",
        EXPECTED_QUERY_IDS.excludeBlocked,
      ],
      ["tier=all&date=2026-07-13&limit=100", EXPECTED_QUERY_IDS.dateJuly13],
      [
        "tier=all&date_from=2026-07-13T21%3A00%3A00.000Z&date_to=2026-07-14T10%3A00%3A00.000Z&limit=100",
        EXPECTED_QUERY_IDS.range,
      ],
    ];
    for (const [query, expected] of cases) {
      const response = await getPublicFeed(request(`/api/public/feed?${query}`));
      expect(response.status).toBe(200);
      expect(ids(await response.json())).toEqual(expected);
    }
  });

  test("preserves localization, view, ordering, pagination totals and ETag", async () => {
    const english = await getPublicFeed(
      request("/api/public/feed?tier=featured&locale=en&limit=100"),
    );
    const englishBody = await english.json();
    expect(englishBody.items[0]).toMatchObject({
      id: "1",
      title: "Alpha event",
      publisher: "Alpha Podcast",
    });

    const chinese = await getPublicFeed(
      request("/api/public/feed?tier=featured&locale=zh&limit=100"),
    );
    expect((await chinese.json()).items[0]).toMatchObject({
      id: "1",
      title: "Alpha 事件",
      publisher: "阿尔法播客",
    });

    const page = await getPublicFeed(
      request("/api/public/feed?tier=all&offset=2&limit=3&view=archive"),
    );
    const pageBody = await page.json();
    expect(ids(pageBody)).toEqual([8, 10, 4]);
    expect(pageBody).toMatchObject({ total: 8, limit: 3, offset: 2, view: "archive" });
    expect(english.headers.get("access-control-allow-origin")).toBe("*");

    const etag = english.headers.get("etag");
    const notModified = await getPublicFeed(
      request("/api/public/feed?tier=featured&locale=en&limit=100", {
        "if-none-match": etag!,
      }),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");

    const today = await getPublicFeed(
      request("/api/public/feed?tier=all&view=today&limit=100"),
    );
    expect(today.status).toBe(200);
    expect((await today.json()).view).toBe("today");
  });

  test("preserves lexical wildcard, filters, localization and stable totals", async () => {
    http.clearRequests();
    const wildcard = await getPublicSearch(
      request("/api/public/search?q=a_00&tier=all&limit=50"),
    );
    const wildcardBody = await wildcard.json();
    expect(ids(wildcardBody)).toEqual(EXPECTED_QUERY_IDS.wildcard);
    expect(wildcardBody).toMatchObject({
      mode: "lexical",
      q: "a_00",
      total: 1,
      limit: 50,
      offset: 0,
    });
    const requested = requestedObjectKeys(http);
    const lexicalKeys = Object.entries(
      (await feedSearchFixtureRelease()).manifest.artifacts,
    )
      .filter(([logicalName]) => logicalName.startsWith("search/lexical/"))
      .map(([, descriptor]) => descriptor.key);
    expect(lexicalKeys).toHaveLength(32);
    expect(lexicalKeys.every((key) => requested.has(key))).toBeTrue();
    expect(requested).toHaveLength(34);
    const requestedStateNames = Object.entries(
      (await feedSearchFixtureRelease()).manifest.artifacts,
    )
      .filter(
        ([logicalName, descriptor]) =>
          logicalName.startsWith("state/") && requested.has(descriptor.key),
      )
      .map(([logicalName]) => logicalName);
    expect(requestedStateNames).toHaveLength(2);
    expect(requestedStateNames).toContain("state/sources");
    expect(
      requestedStateNames.some((logicalName) =>
        logicalName.startsWith("state/items/"),
      ),
    ).toBeTrue();
    const forbiddenStateKeys = Object.entries(
      (await feedSearchFixtureRelease()).manifest.artifacts,
    )
      .filter(
        ([logicalName]) =>
          logicalName.startsWith("state/newsletters/") ||
          logicalName.startsWith("state/policies/"),
      )
      .map(([, descriptor]) => descriptor.key);
    expect(forbiddenStateKeys.some((key) => requested.has(key))).toBeFalse();

    const alphaZh = await getPublicSearch(
      request("/api/public/search?q=Alpha&tier=all&locale=zh&limit=1"),
    );
    const firstPage = await alphaZh.json();
    expect(firstPage.items[0]).toMatchObject({ id: "1", title: "Alpha 事件" });
    expect(firstPage.total).toBeGreaterThan(firstPage.items.length);

    const alphaEn = await getPublicSearch(
      request("/api/public/search?q=Alpha&tier=all&locale=en&offset=1&limit=1"),
    );
    const secondPage = await alphaEn.json();
    expect(secondPage).toMatchObject({
      mode: "lexical",
      q: "Alpha",
      total: firstPage.total,
      limit: 1,
      offset: 1,
    });

    const invalid = await getPublicSearch(request("/api/public/search?limit=2"));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toContain("invalid_query:");
  });

  test("legacy releases retain the release-scoped canonical fallback", async () => {
    const legacy = await buildPublicRelease({
      previousManifest: null,
      sourceWatermark: 19,
      changes: allChanges(PARITY_STATE),
      loadArtifact: async () => {
        throw new Error("fixture cannot load a prior artifact");
      },
    });
    useHttp(singleReleaseStore("https://search-legacy.test", legacy));

    const response = await getPublicSearch(
      request("/api/public/search?q=Alpha&tier=all&limit=50"),
    );
    expect(response.status).toBe(200);
    expect(ids(await response.json())).not.toHaveLength(0);
    const requested = requestedObjectKeys(http);
    expect(
      Object.entries(legacy.manifest.artifacts).some(
        ([logicalName, descriptor]) =>
          logicalName.startsWith("state/") && requested.has(descriptor.key),
      ),
    ).toBeTrue();
  });

  test("corrupt active lexical or hydration artifacts retry the whole previous release", async () => {
    const corruptIndex = await searchFallbackFixture("index");
    useHttp(corruptIndex.http);
    const indexFallback = await getPublicSearch(
      request("/api/public/search?q=Alpha&tier=all&limit=50"),
    );
    expect(indexFallback.status).toBe(200);
    const indexBody = await indexFallback.json();
    expect(indexFallback.headers.get("etag")).toBe(
      computeEtag(
        "public-search",
        etagSignal({
          release: corruptIndex.previous.manifestSha256,
          qs: "?q=Alpha&tier=all&limit=50",
          total: indexBody.total,
          first: indexBody.items[0]?.id ?? "",
        }),
      ),
    );

    const corruptItem = await searchFallbackFixture("item");
    useHttp(corruptItem.http);
    const hydrationFallback = await getPublicSearch(
      request("/api/public/search?q=ActiveOnly&tier=all&limit=50"),
    );
    expect(hydrationFallback.status).toBe(200);
    expect(await hydrationFallback.json()).toMatchObject({
      mode: "lexical",
      q: "ActiveOnly",
      items: [],
      total: 0,
    });

    const partialFamily = await searchFallbackFixture("partial");
    useHttp(partialFamily.http);
    const partialFallback = await getPublicSearch(
      request("/api/public/search?q=ActiveOnly&tier=all&limit=50"),
    );
    expect(partialFallback.status).toBe(200);
    expect(await partialFallback.json()).toMatchObject({ items: [], total: 0 });
    const partialRequested = requestedObjectKeys(partialFamily.http);
    expect(
      Object.entries(partialFamily.active.manifest.artifacts).some(
        ([logicalName, descriptor]) =>
          logicalName.startsWith("state/") &&
          partialRequested.has(descriptor.key),
      ),
    ).toBeFalse();

    const inconsistentRelation = await searchFallbackFixture("relation");
    useHttp(inconsistentRelation.http);
    const relationFallback = await getPublicSearch(
      request("/api/public/search?q=ActiveOnly&tier=all&limit=50"),
    );
    expect(relationFallback.status).toBe(200);
    expect(await relationFallback.json()).toMatchObject({ items: [], total: 0 });
    expect(requestedObjectKeys(inconsistentRelation.http)).toContain(
      inconsistentRelation.relationObjectKey!,
    );
  });

  test("terminal corruption fails closed and a warm process can use its LKG", async () => {
    const release = await buildFixtureRelease();
    const corrupt = singleReleaseStore("https://search-terminal.test", release);
    corrupt.put(
      release.manifest.artifacts[publicLexicalShardLogicalName(0)]!.key,
      canonicalJsonBytes({ invalid: true }),
    );
    useHttp(corrupt);
    const unavailable = await getPublicSearch(
      request("/api/public/search?q=Alpha&tier=all&limit=50"),
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "snapshot_unavailable" });

    const warmRelease = await buildFixtureRelease();
    const warm = singleReleaseStore("https://search-warm-lkg.test", warmRelease);
    useHttp(warm);
    const first = await getPublicSearch(
      request("/api/public/search?q=Alpha&tier=all&limit=50"),
    );
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    warm.delete(CURRENT_POINTER_KEY);
    warm.clearRequests();
    __resetPublicBuckets();
    const fallback = await getPublicSearch(
      request("/api/public/search?q=Alpha&tier=all&limit=50"),
    );
    expect(fallback.status).toBe(200);
    expect(await fallback.json()).toEqual(firstBody);
  });

  test("rejects semantic mode before any snapshot, DB or embedding access", async () => {
    const readsBefore = http.requests.length;
    const response = await getPublicSearch(
      request("/api/public/search?q=agentic+coding&mode=semantic"),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: PUBLIC_SEMANTIC_SEARCH_ERROR,
    });
    expect(http.requests).toHaveLength(readsBefore);
  });

  test("feed/search source graphs contain no DB or semantic runtime", () => {
    const boundary = checkSourcePublicDbBoundary({
      rootDir: process.cwd(),
      entrypointSources: [
        "app/api/public/feed/route.ts",
        "app/api/public/search/route.ts",
      ],
    });
    expect(boundary.ok).toBeTrue();
    expect(boundary.violations).toHaveLength(0);
    expect(boundary.visitedFiles).not.toContain("lib/items/live.ts");
    expect(boundary.visitedFiles).not.toContain("lib/items/semantic-search.ts");
    expect(boundary.visitedFiles).not.toContain("lib/api/search-results.ts");
  });

  test("documents the anonymous semantic 422 and authenticated alternative", async () => {
    const [openapi, skill] = await Promise.all([
      getOpenApi().then((response) => response.text()),
      getSkill().then((response) => response.text()),
    ]);
    for (const document of [openapi, skill]) {
      expect(document).toContain(PUBLIC_SEMANTIC_SEARCH_ERROR);
      expect(document).toContain("422");
      expect(document).toContain("v1/MCP");
    }
    expect(openapi).not.toContain("embeds q via Azure");
    expect(skill).not.toContain("/search?q=...&mode=semantic");
  });
});

function request(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://newsroom.test${path}`, { headers });
}

function ids(body: { items: Array<{ id: string }> }): number[] {
  return body.items.map(({ id }) => Number(id));
}

function requestedObjectKeys(store: MemoryPublicSnapshotHttp): Set<string> {
  return new Set(
    store.requests
      .map(({ key }) => key)
      .filter((key) => key.includes("/objects/")),
  );
}

function useHttp(next: MemoryPublicSnapshotHttp): void {
  http = next;
  process.env.R2_PUBLIC_BASE_URL = next.baseUrl;
  next.clearRequests();
  __resetPublicBuckets();
}

let fixtureRelease: Awaited<ReturnType<typeof buildFixtureRelease>> | undefined;

async function feedSearchFixtureRelease() {
  fixtureRelease ??= await buildFixtureRelease();
  return fixtureRelease;
}

function buildFixtureRelease() {
  return buildPublicRelease({
    previousManifest: null,
    sourceWatermark: 20,
    changes: allChanges(PARITY_STATE),
    generatedAtMs: Date.parse("2026-07-14T12:00:00.000Z"),
    loadArtifact: async () => {
      throw new Error("fixture cannot load a prior artifact");
    },
  });
}

async function feedSearchFixture(): Promise<MemoryPublicSnapshotHttp> {
  const release = await feedSearchFixtureRelease();
  return singleReleaseStore("https://feed-search-content.test", release);
}

function singleReleaseStore(
  baseUrl: string,
  release: Awaited<ReturnType<typeof buildPublicRelease>>,
): MemoryPublicSnapshotHttp {
  const store = new MemoryPublicSnapshotHttp(baseUrl);
  for (const artifact of release.artifacts) {
    store.put(artifact.descriptor.key, artifact.bytes);
  }
  const manifestKey = releaseManifestKey(release.releaseId);
  store.put(manifestKey, release.manifestBytes);
  store.put(
    CURRENT_POINTER_KEY,
    canonicalJsonBytes(
      snapshotPointerSchema.parse({
        schemaVersion: 1,
        active: {
          releaseId: release.releaseId,
          manifestKey,
          manifestSha256: release.manifestSha256,
        },
        previous: null,
        publishedAt: "2026-07-14T12:00:00.000Z",
        sourceWatermark: release.manifest.sourceWatermark,
      }),
    ),
  );
  return store;
}

async function searchFallbackFixture(
  corrupt: "index" | "item" | "partial" | "relation",
) {
  const previous = await buildFixtureRelease();
  const objectBytes = new Map(
    previous.artifacts.map(({ descriptor, bytes }) => [descriptor.key, bytes]),
  );
  const item = PARITY_STATE.items.find(({ id }) => id === 1)!;
  const active = await buildPublicRelease({
    previousManifest: previous.manifest,
    sourceWatermark: 21,
    changes: [
      {
        entityType: "item",
        entityKey: "1",
        value: {
          ...item,
          title: {
            ...item.title,
            raw: "ActiveOnly lexical title",
            en: "ActiveOnly lexical title",
          },
        },
      },
    ],
    generatedAtMs: Date.parse("2026-07-14T12:01:00.000Z"),
    loadArtifact: async (_logicalName, descriptor) => {
      const bytes = objectBytes.get(descriptor.key);
      if (!bytes) throw new Error(`missing fixture object: ${descriptor.key}`);
      return bytes;
    },
  });
  for (const artifact of active.artifacts) {
    objectBytes.set(artifact.descriptor.key, artifact.bytes);
  }
  const store = new MemoryPublicSnapshotHttp(
    `https://search-${corrupt}-fallback.test`,
  );
  for (const [key, bytes] of objectBytes) store.put(key, bytes);
  const previousManifestKey = releaseManifestKey(previous.releaseId);
  const activeManifestKey = releaseManifestKey(active.releaseId);
  store.put(previousManifestKey, previous.manifestBytes);
  let activeManifest = active.manifest;
  let relationObjectKey: string | null = null;
  if (corrupt === "relation") {
    const eventId = item.eventId!;
    const eventLogicalName = publicEntityShardLogicalName(
      "event",
      String(eventId),
    );
    const eventDescriptor = activeManifest.artifacts[eventLogicalName]!;
    const eventBytes = objectBytes.get(eventDescriptor.key)!;
    const eventShard = JSON.parse(new TextDecoder().decode(eventBytes)) as {
      entities: Array<{
        id: number;
        leadItemId: number;
        memberItemIds: number[];
      }>;
    };
    const event = eventShard.entities.find(({ id }) => id === eventId)!;
    event.leadItemId =
      event.memberItemIds.find((memberId) => memberId !== item.id) ??
      item.id + 10_000;
    const inconsistentBytes = canonicalJsonBytes(eventShard);
    const inconsistentSha256 = await sha256Hex(inconsistentBytes);
    const inconsistentDescriptor = {
      ...eventDescriptor,
      key: objectKey(inconsistentSha256, "json"),
      sha256: inconsistentSha256,
      byteLength: inconsistentBytes.byteLength,
    };
    objectBytes.set(inconsistentDescriptor.key, inconsistentBytes);
    store.put(inconsistentDescriptor.key, inconsistentBytes);
    relationObjectKey = inconsistentDescriptor.key;
    activeManifest = manifestSchema.parse({
      ...activeManifest,
      artifacts: {
        ...activeManifest.artifacts,
        [eventLogicalName]: inconsistentDescriptor,
      },
    });
  }
  let activeManifestBytes = canonicalJsonBytes(activeManifest);
  let activeManifestSha256 = await sha256Hex(activeManifestBytes);
  if (corrupt === "partial") {
    const artifacts = { ...activeManifest.artifacts };
    delete artifacts[publicLexicalShardLogicalName(31)];
    const partialManifest = manifestSchema.parse({
      ...activeManifest,
      artifacts,
    });
    activeManifestBytes = canonicalJsonBytes(partialManifest);
    activeManifestSha256 = await sha256Hex(activeManifestBytes);
  } else if (corrupt === "index" || corrupt === "item") {
    const corruptLogicalName =
      corrupt === "index"
        ? publicLexicalShardLogicalName(1)
        : "state/items/01";
    store.put(
      active.manifest.artifacts[corruptLogicalName]!.key,
      canonicalJsonBytes({ invalid: true }),
    );
  }
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
        previous: {
          releaseId: previous.releaseId,
          manifestKey: previousManifestKey,
          manifestSha256: previous.manifestSha256,
        },
        publishedAt: "2026-07-14T12:01:00.000Z",
        sourceWatermark: 21,
      }),
    ),
  );
  return { active, http: store, previous, relationObjectKey };
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
