import { describe, expect, test } from "bun:test";
import { canonicalJsonBytes, sha256Hex } from "@/lib/public-content/canonical";
import {
  manifestSchema,
  snapshotPointerSchema,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import {
  readDirectPublicFeedStories,
  readDirectPublicNewsletters,
  readDirectPublicSources,
} from "@/lib/public-content/direct-route-read";
import { CURRENT_POINTER_KEY, releaseManifestKey } from "@/lib/public-content/paths";
import { objectKey } from "@/lib/public-content/paths";
import { buildPublicRelease } from "@/lib/public-content/publisher/build-release";
import type { PublicEntityChange } from "@/lib/public-content/publisher/types";
import { queryPublicFeed, type PublicFeedQuery } from "@/lib/public-content/query";
import { PublicSnapshotReader } from "@/lib/public-content/reader";
import { MemoryPublicSnapshotHttp } from "@/lib/public-content/testing/memory-store";
import {
  materializedPageLogicalName,
  readScopedMaterializedPageModel,
} from "@/lib/public-content/materialized-artifact";
import {
  PARITY_NOW_ISO,
  PARITY_NOW_MS,
  PARITY_STATE,
} from "./fixtures/parity-corpus";

describe("bounded anonymous route reads", () => {
  test("hydrates exact page stories for representative dynamic filters", async () => {
    const { reader } = await fixture("https://direct-page-parity.test");
    const queries: PublicFeedQuery[] = [
      { tier: "all", locale: "en", limit: 1, offset: 1 },
      { tier: "all", locale: "zh", curatedOnly: true, limit: 50 },
      { tier: "all", locale: "en", sourceGroup: "podcast", includeSourceGroup: true, limit: 120 },
      { tier: "all", locale: "zh", sourceKind: "x-api", limit: 80 },
      { tier: "featured", locale: "zh", date: "2026-07-14", limit: 500 },
    ];

    for (const query of queries) {
      const actual = await reader.readReleaseScoped((scope) =>
        readDirectPublicFeedStories(scope, query, PARITY_NOW_MS),
      );
      const expected = queryPublicFeed(PARITY_STATE, query, {
        nowMs: PARITY_NOW_MS,
      });
      expect(actual.value).toEqual({
        stories: expected.items,
        total: expected.total,
        limit: expected.limit,
        offset: expected.offset,
        view: expected.view,
      });
    }
  });

  test("reads newsletter and source singletons without unrelated state", async () => {
    const { reader, release, store } = await fixture("https://direct-small-state.test");
    store.clearRequests();
    const result = await reader.readReleaseScoped(async (scope) => ({
      newsletters: await readDirectPublicNewsletters(scope),
      sources: await readDirectPublicSources(scope),
    }));

    expect(result.value.newsletters).toEqual(PARITY_STATE.newsletters);
    expect([...result.value.sources].sort(byId)).toEqual(
      [...PARITY_STATE.sources].sort(byId),
    );
    const objectKeys = store.requests
      .map(({ key }) => key)
      .filter((key) => key.includes("/objects/"));
    const allowed = new Set(
      Object.entries(release.manifest.artifacts)
        .filter(([logicalName]) =>
          logicalName === "state/sources" ||
          logicalName.startsWith("state/newsletters/"),
        )
        .map(([, descriptor]) => descriptor.key),
    );
    expect(objectKeys.length).toBeGreaterThan(0);
    expect(objectKeys.every((key) => allowed.has(key))).toBeTrue();
  });

  test("rejects malformed active materialized models and retries previous", async () => {
    const fallback = await fallbackFixture(
      materializedPageLogicalName.agents,
      { schemaVersion: 1, model: {} },
      "https://direct-view-fallback.test",
    );
    const result = await fallback.reader.readReleaseScoped((scope) =>
      readScopedMaterializedPageModel<{ chrome: unknown }>(
        scope,
        materializedPageLogicalName.agents,
      ),
    );

    expect(result.release.source).toBe("previous");
    expect(result.value).toHaveProperty("chrome");
  });

  test("does not trust corrupt recency bounds to omit active segments", async () => {
    const built = await buildFixtureRelease(52);
    const directoryArtifact = built.artifacts.find(
      ({ logicalName }) => logicalName === "feeds/directory",
    )!;
    const directory = JSON.parse(
      new TextDecoder().decode(directoryArtifact.bytes),
    ) as { segments: Array<{ minPublishedAt: string; maxPublishedAt: string }> };
    for (const segment of directory.segments) {
      segment.minPublishedAt = "1999-01-01T00:00:00.000Z";
      segment.maxPublishedAt = "2000-01-01T00:00:00.000Z";
    }
    const fallback = await fallbackFixture(
      "feeds/directory",
      directory,
      "https://direct-directory-fallback.test",
    );
    const query = {
      tier: "all" as const,
      locale: "en" as const,
      limit: 50,
      recencyFloorDays: 30,
    };
    const result = await fallback.reader.readReleaseScoped((scope) =>
      readDirectPublicFeedStories(scope, query, PARITY_NOW_MS),
    );

    expect(result.release.source).toBe("previous");
    expect(result.value.stories).toEqual(
      queryPublicFeed(PARITY_STATE, query, { nowMs: PARITY_NOW_MS }).items,
    );
  });
});

async function fixture(baseUrl: string) {
  const release = await buildFixtureRelease(50);
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
        publishedAt: PARITY_NOW_ISO,
        sourceWatermark: 50,
      }),
    ),
  );
  return {
    reader: new PublicSnapshotReader({ baseUrl, fetch: store.fetch }),
    release,
    store,
  };
}

async function buildFixtureRelease(sourceWatermark: number) {
  return buildPublicRelease({
    previousManifest: null,
    sourceWatermark,
    changes: allChanges(PARITY_STATE),
    generatedAtMs: PARITY_NOW_MS,
    loadArtifact: async () => {
      throw new Error("fixture cannot load a prior artifact");
    },
  });
}

async function fallbackFixture(
  logicalName: string,
  invalidValue: unknown,
  baseUrl: string,
) {
  const [previous, active] = await Promise.all([
    buildFixtureRelease(50),
    buildFixtureRelease(51),
  ]);
  const store = new MemoryPublicSnapshotHttp(baseUrl);
  for (const release of [previous, active]) {
    for (const artifact of release.artifacts) {
      store.put(artifact.descriptor.key, artifact.bytes);
    }
  }
  const invalidBytes = canonicalJsonBytes(invalidValue);
  const sha256 = await sha256Hex(invalidBytes);
  const descriptor = active.manifest.artifacts[logicalName]!;
  const invalidDescriptor = {
    ...descriptor,
    key: objectKey(sha256, "json"),
    sha256,
    byteLength: invalidBytes.byteLength,
  };
  store.put(invalidDescriptor.key, invalidBytes);
  const activeManifest = manifestSchema.parse({
    ...active.manifest,
    artifacts: {
      ...active.manifest.artifacts,
      [logicalName]: invalidDescriptor,
    },
  });
  const activeManifestBytes = canonicalJsonBytes(activeManifest);
  const activeManifestSha256 = await sha256Hex(activeManifestBytes);
  const previousManifestKey = releaseManifestKey(previous.releaseId);
  const activeManifestKey = releaseManifestKey(active.releaseId);
  store.put(previousManifestKey, previous.manifestBytes);
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
        publishedAt: PARITY_NOW_ISO,
        sourceWatermark: 51,
      }),
    ),
  );
  return { reader: new PublicSnapshotReader({ baseUrl, fetch: store.fetch }) };
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function allChanges(state: CanonicalPublicState): PublicEntityChange[] {
  return [
    ...state.sources.map((value) => ({ entityType: "source" as const, entityKey: value.id, value })),
    ...state.items.map((value) => ({ entityType: "item" as const, entityKey: String(value.id), value })),
    ...state.events.map((value) => ({ entityType: "event" as const, entityKey: String(value.id), value })),
    ...state.newsletters.map((value) => ({ entityType: "newsletter" as const, entityKey: String(value.id), value })),
    ...state.policies.map((value) => ({ entityType: "policy" as const, entityKey: value.skillName, value })),
  ];
}
