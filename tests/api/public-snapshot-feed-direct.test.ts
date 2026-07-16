import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { GET as getPublicFeed } from "@/app/api/public/feed/route";
import { computeEtag, etagSignal } from "@/lib/api/public-helpers";
import { canonicalJsonBytes, sha256Hex } from "@/lib/public-content/canonical";
import {
  manifestSchema,
  snapshotPointerSchema,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import {
  CURRENT_POINTER_KEY,
  objectKey,
  releaseManifestKey,
} from "@/lib/public-content/paths";
import {
  parsePublicFeedDefault,
  publicFeedRowsFromState,
  queryPublicFeedRows,
} from "@/lib/public-content/feed-artifacts";
import { buildPublicRelease } from "@/lib/public-content/publisher/build-release";
import type { PublicEntityChange } from "@/lib/public-content/publisher/types";
import { MemoryPublicSnapshotHttp } from "@/lib/public-content/testing/memory-store";
import { __resetPublicBuckets } from "@/lib/rate-limit/public";
import {
  EXPECTED_QUERY_IDS,
  PARITY_NOW_MS,
  PARITY_STATE,
} from "../public-content/fixtures/parity-corpus";

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.R2_PUBLIC_BASE_URL;
const stores = new Map<string, MemoryPublicSnapshotHttp>();

beforeAll(async () => {
  const routedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const store = stores.get(url.origin);
    if (!store) {
      throw new Error(`poison network path: ${url.origin}`);
    }
    return store.fetch(input, init);
  };
  globalThis.fetch = Object.assign(routedFetch, {
    preconnect: () => undefined,
  });
});

beforeEach(() => {
  __resetPublicBuckets();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalBaseUrl === undefined) delete process.env.R2_PUBLIC_BASE_URL;
  else process.env.R2_PUBLIC_BASE_URL = originalBaseUrl;
});

describe("direct public feed artifacts", () => {
  test("default first page reads one route-shaped artifact and no canonical shard", async () => {
    const fixture = await directFeedFixture("https://feed-default-direct.test");
    useFixture(fixture.http);
    const descriptor = fixture.release.manifest.artifacts["feeds/default/en"];
    expect(descriptor).toBeDefined();

    const response = await getPublicFeed(
      new Request("https://newsroom.test/api/public/feed"),
    );

    expect(response.status).toBe(200);
    expect(
      (await response.json()).items.map(({ id }: { id: string }) => Number(id)),
    ).toEqual(EXPECTED_QUERY_IDS.featured);
    expect(fixture.http.requests).toHaveLength(3);
    expect(requestedObjectKeys(fixture.http)).toEqual(new Set([descriptor!.key]));
    expect(descriptor!.byteLength).toBeLessThanOrEqual(500 * 1024);
  });

  test("the localized default uses its own bounded first-page artifact", async () => {
    const fixture = await directFeedFixture("https://feed-default-zh.test");
    useFixture(fixture.http);
    const descriptor = fixture.release.manifest.artifacts["feeds/default/zh"]!;
    const response = await getPublicFeed(
      new Request("https://newsroom.test/api/public/feed?locale=zh"),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).items[0]).toMatchObject({
      id: "1",
      title: "Alpha 事件",
      publisher: "阿尔法播客",
    });
    expect(fixture.http.requests).toHaveLength(3);
    expect(requestedObjectKeys(fixture.http)).toEqual(new Set([descriptor.key]));
    expect(descriptor.byteLength).toBeLessThanOrEqual(500 * 1024);
  });

  test("filtered pagination reads only the directory and compact segments", async () => {
    const fixture = await directFeedFixture("https://feed-segments-direct.test");
    useFixture(fixture.http);
    const response = await getPublicFeed(
      new Request(
        "https://newsroom.test/api/public/feed?tier=all&offset=2&limit=3",
      ),
    );
    expect(response.status).toBe(200);
    expect(
      (await response.json()).items.map(({ id }: { id: string }) => Number(id)),
    ).toEqual([8, 10, 4]);
    const expected = Object.entries(fixture.release.manifest.artifacts)
      .filter(
        ([logicalName]) =>
          logicalName === "feeds/directory" ||
          logicalName.startsWith("feeds/segments/"),
      )
      .map(([, descriptor]) => descriptor.key);
    expect(requestedObjectKeys(fixture.http)).toEqual(new Set(expected));
    expect(
      [...requestedObjectKeys(fixture.http)].some((key) =>
        Object.entries(fixture.release.manifest.artifacts).some(
          ([logicalName, descriptor]) =>
            logicalName.startsWith("state/") && descriptor.key === key,
        ),
      ),
    ).toBeFalse();
  });

  test("date-bounded queries skip non-intersecting historical segments", async () => {
    const state = structuredClone(PARITY_STATE) as CanonicalPublicState;
    const historical = state.items.find(({ id }) => id === 7)!;
    historical.publishedAt = "2026-06-10T16:00:00.000Z";
    const fixture = await directFeedFixture(
      "https://feed-date-segments.test",
      true,
      state,
    );
    useFixture(fixture.http);
    const response = await getPublicFeed(
      new Request(
        "https://newsroom.test/api/public/feed?tier=all&date=2026-07-13&limit=100",
      ),
    );
    expect(response.status).toBe(200);
    expect(
      (await response.json()).items.map(({ id }: { id: string }) => Number(id)),
    ).toEqual(EXPECTED_QUERY_IDS.dateJuly13);
    const requested = requestedObjectKeys(fixture.http);
    const june = Object.entries(fixture.release.manifest.artifacts)
      .filter(([logicalName]) => logicalName.startsWith("feeds/segments/2026-06/"))
      .map(([, descriptor]) => descriptor.key);
    expect(june).not.toHaveLength(0);
    expect(june.some((key) => requested.has(key))).toBeFalse();

    fixture.http.clearRequests();
    __resetPublicBuckets();
    const range = await getPublicFeed(
      new Request(
        "https://newsroom.test/api/public/feed?tier=all&date_from=2026-07-13T21%3A00%3A00.000Z&date_to=2026-07-14T10%3A00%3A00.000Z&limit=100",
      ),
    );
    expect(range.status).toBe(200);
    expect(
      (await range.json()).items.map(({ id }: { id: string }) => Number(id)),
    ).toEqual(EXPECTED_QUERY_IDS.range);
    expect(
      june.some((key) => requestedObjectKeys(fixture.http).has(key)),
    ).toBeFalse();
  });

  test("legacy releases preserve the canonical fallback contract", async () => {
    const legacy = await directFeedFixture(
      "https://feed-legacy-fallback.test",
      false,
    );
    useFixture(legacy.http);
    const response = await getPublicFeed(
      new Request("https://newsroom.test/api/public/feed?tier=all&limit=100"),
    );
    expect(response.status).toBe(200);
    expect(
      (await response.json()).items.map(({ id }: { id: string }) => Number(id)),
    ).toEqual(EXPECTED_QUERY_IDS.all);
    const stateKeys = new Set(
      Object.entries(legacy.release.manifest.artifacts)
        .filter(([logicalName]) => logicalName.startsWith("state/"))
        .map(([, descriptor]) => descriptor.key),
    );
    expect(
      [...requestedObjectKeys(legacy.http)].filter((key) => stateKeys.has(key)),
    ).not.toHaveLength(0);
  });

  test("corrupt active defaults fall back as one release and terminal corruption is 503", async () => {
    const fallback = await feedFallbackFixture();
    useFixture(fallback.http);
    const response = await getPublicFeed(
      new Request("https://newsroom.test/api/public/feed"),
    );
    const expected = parsePublicFeedDefault(
      "en",
      fallback.previous.artifacts.find(
        ({ logicalName }) => logicalName === "feeds/default/en",
      )!.bytes,
    ).result;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
    expect(response.headers.get("etag")).toBe(
      computeEtag(
        "public-feed",
        etagSignal({
          release: fallback.previous.manifestSha256,
          count: expected.items.length,
          total: expected.total,
          first_id: expected.items[0]?.id ?? "",
          latest_at: expected.items[0]?.published_at ?? "",
          qs: "",
        }),
      ),
    );
    expect(requestedObjectKeys(fallback.http)).toEqual(
      new Set([
        fallback.active.manifest.artifacts["feeds/default/en"]!.key,
        fallback.previous.manifest.artifacts["feeds/default/en"]!.key,
      ]),
    );

    const terminal = await directFeedFixture(
      "https://feed-default-terminal.test",
    );
    useFixture(terminal.http);
    terminal.http.put(
      terminal.release.manifest.artifacts["feeds/default/en"]!.key,
      canonicalJsonBytes({ invalid: true }),
    );
    const unavailable = await getPublicFeed(
      new Request("https://newsroom.test/api/public/feed"),
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "snapshot_unavailable" });
  });

  test("a corrupt active segment retries the complete filtered read on previous", async () => {
    const fallback = await feedFallbackFixture("segment");
    useFixture(fallback.http);
    const response = await getPublicFeed(
      new Request("https://newsroom.test/api/public/feed?tier=all&limit=100"),
    );
    const expected = queryPublicFeedRows(
      publicFeedRowsFromState(PARITY_STATE, PARITY_NOW_MS),
      {
        tier: "all",
        locale: "en",
        view: "archive",
        hotWindowHours: 24,
        limit: 100,
        offset: 0,
        includeSourceGroup: true,
      },
      { nowMs: PARITY_NOW_MS },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
    expect(
      [...requestedObjectKeys(fallback.http)].some((key) =>
        Object.entries(fallback.active.manifest.artifacts).some(
          ([logicalName, descriptor]) =>
            logicalName.startsWith("state/") && descriptor.key === key,
        ),
      ),
    ).toBeFalse();
  });

  test("mismatched active directory metadata falls back before date selection", async () => {
    const fallback = await feedFallbackFixture("none");
    const activeDirectory = fallback.active.artifacts.find(
      ({ logicalName }) => logicalName === "feeds/directory",
    )!;
    const value = JSON.parse(new TextDecoder().decode(activeDirectory.bytes)) as {
      segments: Array<Record<string, unknown>>;
    };
    value.segments[0] = { ...value.segments[0]!, month: "2025-01" };
    const bytes = canonicalJsonBytes(value);
    const sha256 = await sha256Hex(bytes);
    const descriptor = {
      ...fallback.active.manifest.artifacts["feeds/directory"]!,
      key: objectKey(sha256, "json"),
      sha256,
      byteLength: bytes.byteLength,
    };
    const manifest = manifestSchema.parse({
      ...fallback.active.manifest,
      artifacts: {
        ...fallback.active.manifest.artifacts,
        "feeds/directory": descriptor,
      },
    });
    const manifestBytes = canonicalJsonBytes(manifest);
    const pointer = snapshotPointerSchema.parse({
      ...fallback.pointer,
      active: {
        ...fallback.pointer.active,
        manifestSha256: await sha256Hex(manifestBytes),
      },
    });
    fallback.http.put(descriptor.key, bytes);
    fallback.http.put(pointer.active.manifestKey, manifestBytes);
    fallback.http.put(CURRENT_POINTER_KEY, canonicalJsonBytes(pointer));
    useFixture(fallback.http);

    const response = await getPublicFeed(
      new Request(
        "https://newsroom.test/api/public/feed?tier=all&date=2026-07-13&limit=100",
      ),
    );
    const expected = queryPublicFeedRows(
      publicFeedRowsFromState(PARITY_STATE, PARITY_NOW_MS),
      {
        tier: "all",
        locale: "en",
        view: "archive",
        hotWindowHours: 24,
        date: "2026-07-13",
        limit: 100,
        offset: 0,
        includeSourceGroup: true,
      },
      { nowMs: PARITY_NOW_MS },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
    expect(
      [...requestedObjectKeys(fallback.http)].some((key) =>
        Object.entries(manifest.artifacts).some(
          ([logicalName, artifact]) =>
            logicalName.startsWith("state/") && artifact.key === key,
        ),
      ),
    ).toBeFalse();
  });

  test("hash-valid active directory timestamp bounds retry the previous release", async () => {
    const fallback = await feedFallbackFixture("none");
    const activeDirectory = fallback.active.artifacts.find(
      ({ logicalName }) => logicalName === "feeds/directory",
    )!;
    const value = JSON.parse(new TextDecoder().decode(activeDirectory.bytes)) as {
      segments: Array<{
        count: number;
        minPublishedAt: string;
        maxPublishedAt: string;
      }>;
    };
    const changed = value.segments.find(({ count }) => count > 1)!;
    changed.minPublishedAt = changed.maxPublishedAt;
    await installActiveDirectory(fallback, value);
    useFixture(fallback.http);

    const response = await getPublicFeed(
      new Request(
        "https://newsroom.test/api/public/feed?tier=all&limit=100",
      ),
    );
    const expected = queryPublicFeedRows(
      publicFeedRowsFromState(PARITY_STATE, PARITY_NOW_MS),
      {
        tier: "all",
        locale: "en",
        view: "archive",
        hotWindowHours: 24,
        limit: 100,
        offset: 0,
        includeSourceGroup: true,
      },
      { nowMs: PARITY_NOW_MS },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
  });

  test("corrupt directory or segment artifacts fail closed without canonical aggregation", async () => {
    const corruptDirectory = await directFeedFixture(
      "https://feed-directory-terminal.test",
    );
    useFixture(corruptDirectory.http);
    corruptDirectory.http.put(
      corruptDirectory.release.manifest.artifacts["feeds/directory"]!.key,
      canonicalJsonBytes({ invalid: true }),
    );
    const directoryResponse = await getPublicFeed(
      new Request("https://newsroom.test/api/public/feed?tier=all&limit=100"),
    );
    expect(directoryResponse.status).toBe(503);
    expect(await directoryResponse.json()).toEqual({
      error: "snapshot_unavailable",
    });

    const corruptSegment = await directFeedFixture(
      "https://feed-segment-terminal.test",
    );
    useFixture(corruptSegment.http);
    const segment = Object.entries(corruptSegment.release.manifest.artifacts).find(
      ([logicalName]) => logicalName.startsWith("feeds/segments/"),
    )!;
    corruptSegment.http.put(segment[1].key, canonicalJsonBytes({ invalid: true }));
    const segmentResponse = await getPublicFeed(
      new Request("https://newsroom.test/api/public/feed?tier=all&limit=100"),
    );
    expect(segmentResponse.status).toBe(503);
    expect(await segmentResponse.json()).toEqual({
      error: "snapshot_unavailable",
    });
    expect(
      [...requestedObjectKeys(corruptSegment.http)].some((key) =>
        Object.entries(corruptSegment.release.manifest.artifacts).some(
          ([logicalName, descriptor]) =>
            logicalName.startsWith("state/") && descriptor.key === key,
        ),
      ),
    ).toBeFalse();
  });

  test("a warm process serves its last-known-good direct feed release", async () => {
    const fixture = await directFeedFixture("https://feed-warm-lkg.test");
    useFixture(fixture.http);
    const first = await getPublicFeed(
      new Request("https://newsroom.test/api/public/feed"),
    );
    const firstBody = await first.json();
    fixture.http.delete(CURRENT_POINTER_KEY);
    fixture.http.clearRequests();

    const fallback = await getPublicFeed(
      new Request("https://newsroom.test/api/public/feed"),
    );
    expect(fallback.status).toBe(200);
    expect(await fallback.json()).toEqual(firstBody);
  });
});

function useFixture(http: MemoryPublicSnapshotHttp): void {
  stores.set(http.baseUrl, http);
  process.env.R2_PUBLIC_BASE_URL = http.baseUrl;
  http.clearRequests();
}

function requestedObjectKeys(http: MemoryPublicSnapshotHttp): Set<string> {
  return new Set(
    http.requests
      .map(({ key }) => key)
      .filter((key) => key.includes("/objects/")),
  );
}

async function directFeedFixture(
  baseUrl: string,
  direct = true,
  state: CanonicalPublicState = PARITY_STATE,
) {
  const release = await buildPublicRelease({
    previousManifest: null,
    sourceWatermark: 20,
    changes: allChanges(state),
    ...(direct
      ? { generatedAtMs: Date.parse("2026-07-14T12:00:00.000Z") }
      : {}),
    loadArtifact: async () => {
      throw new Error("fixture cannot load a prior artifact");
    },
  });
  const http = new MemoryPublicSnapshotHttp(baseUrl);
  for (const artifact of release.artifacts) {
    http.put(artifact.descriptor.key, artifact.bytes);
  }
  const manifestKey = releaseManifestKey(release.releaseId);
  http.put(manifestKey, release.manifestBytes);
  http.put(
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
        sourceWatermark: 20,
      }),
    ),
  );
  return { http, release };
}

async function feedFallbackFixture(
  corrupt: "default" | "segment" | "none" = "default",
) {
  const previous = await buildPublicRelease({
    previousManifest: null,
    sourceWatermark: 20,
    changes: allChanges(PARITY_STATE),
    generatedAtMs: Date.parse("2026-07-14T12:00:00.000Z"),
    loadArtifact: async () => {
      throw new Error("fixture cannot load a prior artifact");
    },
  });
  const objectBytes = new Map(
    previous.artifacts.map(({ descriptor, bytes }) => [descriptor.key, bytes]),
  );
  const item = PARITY_STATE.items.find(({ id }) => id === 10)!;
  const active = await buildPublicRelease({
    previousManifest: previous.manifest,
    sourceWatermark: 21,
    changes: [
      {
        entityType: "item",
        entityKey: "10",
        value: {
          ...item,
          title: { ...item.title, en: "Corrupt active feed title" },
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
  const http = new MemoryPublicSnapshotHttp("https://feed-previous-fallback.test");
  for (const [key, bytes] of objectBytes) http.put(key, bytes);
  const previousManifestKey = releaseManifestKey(previous.releaseId);
  const activeManifestKey = releaseManifestKey(active.releaseId);
  http.put(previousManifestKey, previous.manifestBytes);
  http.put(activeManifestKey, active.manifestBytes);
  if (corrupt !== "none") {
    const corruptLogicalName =
      corrupt === "default" ? "feeds/default/en" : "feeds/segments/2026-07/2";
    http.put(
      active.manifest.artifacts[corruptLogicalName]!.key,
      canonicalJsonBytes({ invalid: true }),
    );
  }
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
    publishedAt: "2026-07-14T12:01:00.000Z",
    sourceWatermark: 21,
  });
  http.put(
    CURRENT_POINTER_KEY,
    canonicalJsonBytes(pointer),
  );
  return { active, http, pointer, previous };
}

async function installActiveDirectory(
  fallback: Awaited<ReturnType<typeof feedFallbackFixture>>,
  value: unknown,
): Promise<void> {
  const bytes = canonicalJsonBytes(value);
  const sha256 = await sha256Hex(bytes);
  const descriptor = {
    ...fallback.active.manifest.artifacts["feeds/directory"]!,
    key: objectKey(sha256, "json"),
    sha256,
    byteLength: bytes.byteLength,
  };
  const manifest = manifestSchema.parse({
    ...fallback.active.manifest,
    artifacts: {
      ...fallback.active.manifest.artifacts,
      "feeds/directory": descriptor,
    },
  });
  const manifestBytes = canonicalJsonBytes(manifest);
  const pointer = snapshotPointerSchema.parse({
    ...fallback.pointer,
    active: {
      ...fallback.pointer.active,
      manifestSha256: await sha256Hex(manifestBytes),
    },
  });
  fallback.http.put(descriptor.key, bytes);
  fallback.http.put(pointer.active.manifestKey, manifestBytes);
  fallback.http.put(CURRENT_POINTER_KEY, canonicalJsonBytes(pointer));
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
