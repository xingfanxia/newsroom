import { describe, expect, test } from "bun:test";
import { canonicalJsonBytes, sha256Hex } from "@/lib/public-content/canonical";
import { snapshotPointerSchema } from "@/lib/public-content/contracts";
import { CURRENT_POINTER_KEY, releaseManifestKey } from "@/lib/public-content/paths";
import { buildPublicRelease } from "@/lib/public-content/publisher/build-release";
import type { PublicEntityChange } from "@/lib/public-content/publisher/types";
import { PublicSnapshotReader } from "@/lib/public-content/reader";
import { PublicSnapshotUnavailableError } from "@/lib/public-content/reader/types";
import { MemoryPublicSnapshotHttp } from "@/lib/public-content/testing/memory-store";
import { checkSourcePublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import { canonicalState } from "./contract-fixtures";

const PUBLISHED_AT = "2026-07-14T12:00:00.000Z";

describe("public snapshot reader", () => {
  test("reads the active release, pins one origin, and caches immutable objects", async () => {
    const fixture = await snapshotFixture();
    const reader = fixture.reader();

    const first = await reader.readCanonicalState();
    expect(first.release.source).toBe("active");
    expect(first.state.items[0]?.title.en).toBe("Changed title");
    expect(fixture.http.requests.every(({ key }) => !key.startsWith("/"))).toBeTrue();
    expect(
      fixture.http.requests.find(({ key }) => key === CURRENT_POINTER_KEY)?.cache,
    ).toBe("no-store");
    expect(
      fixture.http.requests
        .filter(({ key }) => key !== CURRENT_POINTER_KEY)
        .every(({ cache, redirect }) =>
          cache === "force-cache" && redirect === "error"
        ),
    ).toBeTrue();

    const immutableReads = fixture.http.requests.filter(
      ({ key }) => key !== CURRENT_POINTER_KEY,
    ).length;
    await reader.readCanonicalState();
    expect(fixture.http.requestCount(CURRENT_POINTER_KEY)).toBe(2);
    expect(
      fixture.http.requests.filter(({ key }) => key !== CURRENT_POINTER_KEY),
    ).toHaveLength(immutableReads);
  });

  test("falls back to previous when the active manifest is corrupt", async () => {
    const fixture = await snapshotFixture();
    fixture.http.put(
      releaseManifestKey(fixture.active.releaseId),
      new TextEncoder().encode('{"corrupt":true}\n'),
    );

    const result = await fixture.reader().readCanonicalState();
    expect(result.release.source).toBe("previous");
    expect(result.release.ref.releaseId).toBe(fixture.previous.releaseId);
    expect(result.state.items[0]?.title.en).toBe(
      fixture.previousState.items[0]?.title.en,
    );
  });

  test("falls back as a whole release when an active artifact is corrupt", async () => {
    const fixture = await snapshotFixture();
    const changed = fixture.active.artifacts.find(({ unchanged }) => !unchanged);
    expect(changed).toBeDefined();
    fixture.http.put(
      changed!.descriptor.key,
      new TextEncoder().encode('{"schemaVersion":1,"corrupt":true}\n'),
    );

    const result = await fixture.reader().readCanonicalState();
    expect(result.release.source).toBe("previous");
    expect(result.state.items[0]?.title.en).toBe(
      fixture.previousState.items[0]?.title.en,
    );
    expect(result.state.items.some(({ title }) => title.en === "Changed title")).toBeFalse();
  });

  test("serves only a warm last-known-good release when current becomes unavailable", async () => {
    const fixture = await snapshotFixture();
    const reader = fixture.reader(5);
    const warm = await reader.readCanonicalState();
    fixture.http.hang(CURRENT_POINTER_KEY);

    const fallback = await reader.readCanonicalState();
    expect(fallback.release.source).toBe("last-known-good");
    expect(fallback.release.ref.releaseId).toBe(warm.release.ref.releaseId);
    expect(fallback.state).toEqual(warm.state);
  });

  test("fails closed for missing, corrupt, unknown-schema, and timed-out snapshots", async () => {
    const missing = new MemoryPublicSnapshotHttp();
    await expect(
      new PublicSnapshotReader({ baseUrl: missing.baseUrl, fetch: missing.fetch })
        .readCanonicalState(),
    ).rejects.toBeInstanceOf(PublicSnapshotUnavailableError);

    const unknownPointer = new MemoryPublicSnapshotHttp();
    unknownPointer.put(
      CURRENT_POINTER_KEY,
      canonicalJsonBytes({ schemaVersion: 2, unexpected: true }),
    );
    await expect(
      new PublicSnapshotReader({
        baseUrl: unknownPointer.baseUrl,
        fetch: unknownPointer.fetch,
      }).readCanonicalState(),
    ).rejects.toBeInstanceOf(PublicSnapshotUnavailableError);

    const unknownManifest = new MemoryPublicSnapshotHttp();
    const manifestBytes = canonicalJsonBytes({
      schemaVersion: 2,
      releaseId: "r20-unknown",
      sourceWatermark: 20,
      artifacts: {},
    });
    const pointer = snapshotPointerSchema.parse({
      schemaVersion: 1,
      active: {
        releaseId: "r20-unknown",
        manifestKey: releaseManifestKey("r20-unknown"),
        manifestSha256: await sha256Hex(manifestBytes),
      },
      previous: null,
      publishedAt: PUBLISHED_AT,
      sourceWatermark: 20,
    });
    unknownManifest.put(CURRENT_POINTER_KEY, canonicalJsonBytes(pointer));
    unknownManifest.put(pointer.active.manifestKey, manifestBytes);
    await expect(
      new PublicSnapshotReader({
        baseUrl: unknownManifest.baseUrl,
        fetch: unknownManifest.fetch,
      }).readCanonicalState(),
    ).rejects.toBeInstanceOf(PublicSnapshotUnavailableError);

    const timeout = new MemoryPublicSnapshotHttp();
    timeout.hang(CURRENT_POINTER_KEY);
    await expect(
      new PublicSnapshotReader({
        baseUrl: timeout.baseUrl,
        fetch: timeout.fetch,
        timeoutMs: 5,
      }).readCanonicalState(),
    ).rejects.toBeInstanceOf(PublicSnapshotUnavailableError);
  });

  test("rejects arbitrary keys and has no runtime DB path", async () => {
    const fixture = await snapshotFixture();
    await expect(
      fixture.reader().readLogicalArtifact("../private/secret"),
    ).rejects.toBeInstanceOf(PublicSnapshotUnavailableError);
    expect(fixture.http.requests).toHaveLength(0);

    const boundary = checkSourcePublicDbBoundary({
      rootDir: process.cwd(),
      entrypointSources: ["lib/public-content/reader/index.ts"],
    });
    expect(boundary.ok).toBeTrue();
    expect(boundary.violations).toHaveLength(0);
  });
});

async function snapshotFixture() {
  const http = new MemoryPublicSnapshotHttp();
  const previousState = canonicalState();
  const previous = await buildPublicRelease({
    previousManifest: null,
    sourceWatermark: 10,
    changes: allChanges(previousState),
    loadArtifact: async () => {
      throw new Error("initial release cannot load a prior artifact");
    },
  });
  const objectBytes = new Map<string, Uint8Array>();
  for (const artifact of previous.artifacts) {
    objectBytes.set(artifact.descriptor.key, artifact.bytes);
  }
  const changed = {
    ...previousState.items[0]!,
    title: { ...previousState.items[0]!.title, en: "Changed title" },
  };
  const active = await buildPublicRelease({
    previousManifest: previous.manifest,
    sourceWatermark: 11,
    changes: [
      {
        entityType: "item",
        entityKey: String(changed.id),
        value: changed,
      },
    ],
    loadArtifact: async (_logicalName, descriptor) => {
      const bytes = objectBytes.get(descriptor.key);
      if (!bytes) throw new Error(`missing fixture object: ${descriptor.key}`);
      return bytes.slice();
    },
  });
  for (const artifact of active.artifacts) {
    objectBytes.set(artifact.descriptor.key, artifact.bytes);
  }
  for (const [key, bytes] of objectBytes) http.put(key, bytes);
  http.put(releaseManifestKey(previous.releaseId), previous.manifestBytes);
  http.put(releaseManifestKey(active.releaseId), active.manifestBytes);
  const pointer = snapshotPointerSchema.parse({
    schemaVersion: 1,
    active: releaseRef(active),
    previous: releaseRef(previous),
    publishedAt: PUBLISHED_AT,
    sourceWatermark: 11,
  });
  http.put(CURRENT_POINTER_KEY, canonicalJsonBytes(pointer));
  http.clearRequests();
  return {
    active,
    http,
    pointer,
    previous,
    previousState,
    reader: (timeoutMs = 100) =>
      new PublicSnapshotReader({
        baseUrl: http.baseUrl,
        fetch: http.fetch,
        timeoutMs,
      }),
  };
}

function releaseRef(release: Awaited<ReturnType<typeof buildPublicRelease>>) {
  return {
    releaseId: release.releaseId,
    manifestKey: releaseManifestKey(release.releaseId),
    manifestSha256: release.manifestSha256,
  };
}

function allChanges(
  state: ReturnType<typeof canonicalState>,
): PublicEntityChange[] {
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
