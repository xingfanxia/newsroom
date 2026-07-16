import { describe, expect, test } from "bun:test";
import { canonicalJsonBytes, sha256Hex } from "@/lib/public-content/canonical";
import {
  manifestSchema,
  publicEntityShardLogicalName,
  publicItemBodyShardLogicalName,
  snapshotPointerSchema,
} from "@/lib/public-content/contracts";
import {
  CURRENT_POINTER_KEY,
  releaseManifestKey,
} from "@/lib/public-content/paths";
import { buildPublicRelease } from "@/lib/public-content/publisher/build-release";
import type { PublicEntityChange } from "@/lib/public-content/publisher/types";
import { PublicSnapshotReader } from "@/lib/public-content/reader";
import { PublicSnapshotUnavailableError } from "@/lib/public-content/reader/types";
import { MemoryPublicSnapshotHttp } from "@/lib/public-content/testing/memory-store";
import { checkSourcePublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import { canonicalState } from "./contract-fixtures";

const PUBLISHED_AT = "2026-07-14T12:00:00.000Z";

describe("public snapshot reader", () => {
  test("allows loopback HTTP fixtures without permitting remote plaintext origins", () => {
    expect(
      () => new PublicSnapshotReader({ baseUrl: "http://127.0.0.1:43123" }),
    ).not.toThrow();
    expect(
      () => new PublicSnapshotReader({ baseUrl: "http://localhost:43123" }),
    ).not.toThrow();
    expect(
      () => new PublicSnapshotReader({ baseUrl: "http://example.com" }),
    ).toThrow("HTTPS origin or loopback HTTP origin");
  });

  test("reads the active release, pins one origin, and caches immutable objects", async () => {
    const fixture = await snapshotFixture();
    const reader = fixture.reader();

    const first = await reader.readCanonicalState();
    expect(first.release.source).toBe("active");
    expect(first.state.items[0]?.title.en).toBe("Changed title");
    expect(
      fixture.http.requests.every(({ key }) => !key.startsWith("/")),
    ).toBeTrue();
    expect(
      fixture.http.requests.find(({ key }) => key === CURRENT_POINTER_KEY)
        ?.cache,
    ).toBe("no-store");
    expect(
      fixture.http.requests
        .filter(({ key }) => key !== CURRENT_POINTER_KEY)
        .every(
          ({ cache, redirect }) =>
            cache === "force-cache" && redirect === "error",
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

  test("memoizes the PARSED state per release — repeat reads skip the JSON+zod pass", async () => {
    const fixture = await snapshotFixture();
    const reader = fixture.reader();
    const first = await reader.readCanonicalState();
    const second = await reader.readCanonicalState();
    // Identity, not equality: the multi-MB parse/validate must run once
    // per release, not once per request (this was the 2-5s page cost).
    expect(second.state).toBe(first.state);

    // Concurrent cold reads share one in-flight parse.
    const cold = fixture.reader();
    const [a, b] = await Promise.all([
      cold.readCanonicalState(),
      cold.readCanonicalState(),
    ]);
    expect(b.state).toBe(a.state);
  });

  test("keeps body shards out of canonical state and reads one body bucket by id", async () => {
    const fixture = await snapshotFixture();
    const reader = fixture.reader();
    const snapshot = await reader.readCanonicalState();

    expect(snapshot.state.items.every(({ bodyMd }) => bodyMd === null)).toBe(
      true,
    );
    expect(await reader.readItemBody(snapshot.release, 1)).toBe(
      "Changed body bytes",
    );
    expect(await reader.readItemBody(snapshot.release, 129)).toBeNull();
  });

  test("returns null without fetching when a legacy release has no body descriptor", async () => {
    const fixture = await snapshotFixture();
    const reader = fixture.reader();
    const release = await reader.readRelease();
    const legacyRelease = {
      ...release,
      manifest: {
        ...release.manifest,
        artifacts: Object.fromEntries(
          Object.entries(release.manifest.artifacts).filter(
            ([logicalName]) => !logicalName.startsWith("bodies/items/"),
          ),
        ),
      },
    };
    fixture.http.clearRequests();

    expect(await reader.readItemBody(legacyRelease, 1)).toBeNull();
    expect(fixture.http.requests).toHaveLength(0);
  });

  test("pins body reads to the supplied release across a pointer flip", async () => {
    const fixture = await snapshotFixture();
    const reader = fixture.reader();
    const release = await reader.readRelease();
    const repointed = snapshotPointerSchema.parse({
      schemaVersion: 1,
      active: releaseRef(fixture.previous),
      previous: null,
      publishedAt: PUBLISHED_AT,
      sourceWatermark: fixture.previous.manifest.sourceWatermark,
    });
    fixture.http.put(CURRENT_POINTER_KEY, canonicalJsonBytes(repointed));
    fixture.http.clearRequests();

    expect(await reader.readItemBody(release, 1)).toBe("Changed body bytes");
    expect(fixture.http.requestCount(CURRENT_POINTER_KEY)).toBe(0);
  });

  test("pins dependent scoped reads to one release across a pointer flip", async () => {
    const fixture = await snapshotFixture();
    const reader = fixture.reader();
    const itemLogicalName = publicEntityShardLogicalName("item", "1");

    const result = await reader.readReleaseScoped(async (scope) => {
      const item = await scope.readLogicalArtifact(itemLogicalName, {
        required: true,
      });
      const repointed = snapshotPointerSchema.parse({
        schemaVersion: 1,
        active: releaseRef(fixture.previous),
        previous: null,
        publishedAt: PUBLISHED_AT,
        sourceWatermark: fixture.previous.manifest.sourceWatermark,
      });
      fixture.http.put(CURRENT_POINTER_KEY, canonicalJsonBytes(repointed));
      const body = await scope.readLogicalArtifact(
        publicItemBodyShardLogicalName("1"),
        { required: true },
      );
      return {
        item: JSON.parse(new TextDecoder().decode(item!.bytes)) as {
          entities: Array<{ title: { en: string | null } }>;
        },
        body: JSON.parse(new TextDecoder().decode(body!.bytes)) as {
          entities: Array<{ bodyMd: string }>;
        },
      };
    });

    expect(result.release.source).toBe("active");
    expect(result.value.item.entities[0]?.title.en).toBe("Changed title");
    expect(result.value.body.entities[0]?.bodyMd).toBe("Changed body bytes");
    expect(fixture.http.requestCount(CURRENT_POINTER_KEY)).toBe(1);
  });

  test("retries a scoped multi-artifact operation against previous as one release", async () => {
    const fixture = await snapshotFixture();
    const logicalName = publicEntityShardLogicalName("item", "1");
    const activeDescriptor = fixture.active.manifest.artifacts[logicalName]!;
    fixture.http.put(
      activeDescriptor.key,
      new TextEncoder().encode('{"schemaVersion":1,"corrupt":true}\n'),
    );

    const result = await fixture.reader().readReleaseScoped(async (scope) => {
      const item = await scope.readLogicalArtifact(logicalName, {
        required: true,
      });
      const body = await scope.readLogicalArtifact(
        publicItemBodyShardLogicalName("1"),
        { required: true },
      );
      return {
        item: JSON.parse(new TextDecoder().decode(item!.bytes)) as {
          entities: Array<{ title: { en: string | null } }>;
        },
        body: JSON.parse(new TextDecoder().decode(body!.bytes)) as {
          entities: Array<{ bodyMd: string }>;
        },
      };
    });

    expect(result.release.source).toBe("previous");
    expect(result.value.item.entities[0]?.title.en).toBe(
      fixture.previousState.items[0]?.title.en,
    );
    expect(result.value.body.entities[0]?.bodyMd).toBe(
      fixture.previousState.items[0]?.bodyMd,
    );
  });

  test("keeps legacy canonical fallback inside the selected release scope", async () => {
    const fixture = await snapshotFixture();
    const reader = fixture.reader();

    const result = await reader.readReleaseScoped((scope) =>
      scope.readCanonicalState(),
    );

    expect(result.release.source).toBe("active");
    expect(result.value.state.items[0]?.title.en).toBe("Changed title");
    expect(result.value.release).toBe(result.release);
    expect(fixture.http.requestCount(CURRENT_POINTER_KEY)).toBe(1);
  });

  test("uses the warm last-known-good release for scoped reads", async () => {
    const fixture = await snapshotFixture();
    const reader = fixture.reader(5);
    const logicalName = publicEntityShardLogicalName("item", "1");
    const warm = await reader.readReleaseScoped((scope) =>
      scope.readLogicalArtifact(logicalName, { required: true }),
    );
    fixture.http.hang(CURRENT_POINTER_KEY);

    const fallback = await reader.readReleaseScoped((scope) =>
      scope.readLogicalArtifact(logicalName, { required: true }),
    );

    expect(warm.release.source).toBe("active");
    expect(fallback.release.source).toBe("last-known-good");
    expect(fallback.release.ref.releaseId).toBe(warm.release.ref.releaseId);
  });

  test("returns a missing optional scoped artifact without release fallback", async () => {
    const fixture = await snapshotFixture();
    let attempts = 0;

    const result = await fixture.reader().readReleaseScoped(async (scope) => {
      attempts += 1;
      return scope.readLogicalArtifact("future/optional");
    });

    expect(result.release.source).toBe("active");
    expect(result.value).toBeNull();
    expect(attempts).toBe(1);
  });

  test("retries a required scoped artifact missing from active on previous", async () => {
    const fixture = await snapshotFixture();
    const logicalName = publicItemBodyShardLogicalName("1");
    const manifest = manifestSchema.parse({
      ...fixture.active.manifest,
      artifacts: Object.fromEntries(
        Object.entries(fixture.active.manifest.artifacts).filter(
          ([candidate]) => candidate !== logicalName,
        ),
      ),
    });
    const manifestBytes = canonicalJsonBytes(manifest);
    const pointer = snapshotPointerSchema.parse({
      ...fixture.pointer,
      active: {
        ...fixture.pointer.active,
        manifestSha256: await sha256Hex(manifestBytes),
      },
    });
    fixture.http.put(pointer.active.manifestKey, manifestBytes);
    fixture.http.put(CURRENT_POINTER_KEY, canonicalJsonBytes(pointer));
    fixture.http.clearRequests();
    const attempts: string[] = [];

    const result = await fixture.reader().readReleaseScoped(async (scope) => {
      attempts.push(scope.release.source);
      return scope.readLogicalArtifact(logicalName, { required: true });
    });

    expect(result.release.source).toBe("previous");
    expect(result.value).not.toBeNull();
    expect(attempts).toEqual(["active", "previous"]);
  });

  test("does not retry or mask a scoped callback programming error", async () => {
    const fixture = await snapshotFixture();
    const injected = new TypeError("injected consumer bug");
    let attempts = 0;

    await expect(
      fixture.reader().readReleaseScoped(async (scope) => {
        attempts += 1;
        await scope.readLogicalArtifact("state/sources", { required: true });
        throw injected;
      }),
    ).rejects.toBe(injected);
    expect(attempts).toBe(1);
  });

  test("rejects an invalid scoped logical name once without object reads", async () => {
    const fixture = await snapshotFixture();
    const objectKeys = new Set(
      Object.values(fixture.active.manifest.artifacts).map(({ key }) => key),
    );
    let attempts = 0;

    await expect(
      fixture.reader().readReleaseScoped((scope) => {
        attempts += 1;
        return scope.readLogicalArtifact("../private/secret", {
          required: true,
        });
      }),
    ).rejects.toBeInstanceOf(PublicSnapshotUnavailableError);
    expect(attempts).toBe(1);
    expect(
      fixture.http.requests.some(({ key }) => objectKeys.has(key)),
    ).toBeFalse();
  });

  test("rejects corrupt release-pinned body bytes", async () => {
    const fixture = await snapshotFixture();
    const reader = fixture.reader();
    const release = await reader.readRelease();
    const descriptor =
      release.manifest.artifacts[publicItemBodyShardLogicalName("1")]!;
    fixture.http.put(
      descriptor.key,
      new TextEncoder().encode('{"corrupt":true}\n'),
    );

    await expect(reader.readItemBody(release, 1)).rejects.toThrow(
      "public artifact integrity mismatch",
    );
  });

  test("does not let a warm artifact cache bypass descriptor length integrity", async () => {
    const fixture = await snapshotFixture();
    const reader = fixture.reader();
    const release = await reader.readRelease();
    const logicalName = publicItemBodyShardLogicalName("1");
    const descriptor = release.manifest.artifacts[logicalName]!;
    expect(await reader.readItemBody(release, 1)).toBe("Changed body bytes");
    const malformedRelease = {
      ...release,
      manifest: {
        ...release.manifest,
        artifacts: {
          ...release.manifest.artifacts,
          [logicalName]: {
            ...descriptor,
            byteLength: descriptor.byteLength + 1,
          },
        },
      },
    };

    await expect(reader.readItemBody(malformedRelease, 1)).rejects.toThrow(
      "public artifact integrity mismatch",
    );
  });

  test("a pointer release change replaces the memoized state", async () => {
    const fixture = await snapshotFixture();
    const reader = fixture.reader();
    const first = await reader.readCanonicalState();

    const repointed = snapshotPointerSchema.parse({
      schemaVersion: 1,
      active: {
        releaseId: fixture.previous.releaseId,
        manifestKey: releaseManifestKey(fixture.previous.releaseId),
        manifestSha256: fixture.previous.manifestSha256,
      },
      previous: null,
      publishedAt: PUBLISHED_AT,
      sourceWatermark: 10,
    });
    fixture.http.put(CURRENT_POINTER_KEY, canonicalJsonBytes(repointed));

    const next = await reader.readCanonicalState();
    expect(next.state).not.toBe(first.state);
    expect(next.release.ref.releaseId).toBe(fixture.previous.releaseId);
    expect(next.state.items[0]?.title.en).toBe(
      fixture.previousState.items[0]?.title.en,
    );
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
    const changed = fixture.active.artifacts.find(
      ({ unchanged }) => !unchanged,
    );
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
    expect(
      result.state.items.some(({ title }) => title.en === "Changed title"),
    ).toBeFalse();
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
      new PublicSnapshotReader({
        baseUrl: missing.baseUrl,
        fetch: missing.fetch,
      }).readCanonicalState(),
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

  test("retries one transient snapshot network failure", async () => {
    const fixture = await snapshotFixture();
    let failed = false;
    const reader = new PublicSnapshotReader({
      baseUrl: fixture.http.baseUrl,
      fetch: async (input, init) => {
        if (!failed) {
          failed = true;
          throw new Error("injected transient network failure");
        }
        return fixture.http.fetch(input, init);
      },
      timeoutMs: 100,
    });
    const result = await reader.readCanonicalState();
    expect(failed).toBeTrue();
    expect(result.release.source).toBe("active");
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
    bodyMd: "Changed body bytes",
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
