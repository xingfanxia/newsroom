import { sha256Hex } from "@/lib/public-content/canonical";
import {
  canonicalStateSchema,
  manifestSchema,
  parsePublicEntityShardValue,
  parsePublicItemBodyShardValue,
  publicItemBodyShardLogicalName,
  snapshotPointerSchema,
} from "@/lib/public-content/contracts";
import { CURRENT_POINTER_KEY, isSafeLogicalName } from "@/lib/public-content/paths";
import { PublicSnapshotHttpFetcher, type PublicSnapshotFetch } from "./fetch-object";
import {
  PublicSnapshotUnavailableError,
  type PublicCanonicalStateResult,
  type PublicLogicalArtifact,
  type PublicSnapshotReadSource,
  type ResolvedPublicRelease,
  type SnapshotArtifactDescriptor,
  type SnapshotManifest,
  type SnapshotPointer,
  type SnapshotReleaseRef,
} from "./types";

const POINTER_MAX_BYTES = 64 * 1024;
const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
const ARTIFACT_MAX_BYTES = 64 * 1024 * 1024;
const MAX_STATE_ARTIFACTS = 800;
const STATE_FETCH_CONCURRENCY = 16;
/** active + previous — a third release id evicts the oldest entry. */
const STATE_CACHE_MAX_RELEASES = 2;

export class PublicSnapshotReader {
  readonly #fetcher: PublicSnapshotHttpFetcher;
  readonly #manifestCache = new Map<string, Promise<SnapshotManifest>>();
  readonly #artifactCache = new Map<string, Promise<Uint8Array>>();
  /**
   * Parsed-state memo keyed by release identity. Shard BYTES were always
   * cached, but the multi-MB JSON.parse + zod validation re-ran on every
   * readCanonicalState() call — the dominant per-request cost for every
   * consumer (page chrome, page models, public API, RSS). Releases are
   * immutable, so the parse is safe to run once per release. Callers
   * receive a SHARED state object and must treat it as read-only (the
   * last-known-good path already shared state this way).
   */
  readonly #stateCache = new Map<
    string,
    Promise<ReturnType<typeof canonicalStateSchema.parse>>
  >();
  #lastKnownGoodRelease: ResolvedPublicRelease | null = null;
  #lastKnownGoodState: PublicCanonicalStateResult | null = null;

  constructor(options: {
    baseUrl: string;
    fetch?: PublicSnapshotFetch;
    timeoutMs?: number;
  }) {
    this.#fetcher = new PublicSnapshotHttpFetcher(options);
  }

  async readRelease(): Promise<ResolvedPublicRelease> {
    const candidates = await this.#candidateReleases();
    const release = candidates[0];
    if (release) {
      this.#lastKnownGoodRelease = release;
      return release;
    }
    if (this.#lastKnownGoodRelease) {
      return asLastKnownGood(this.#lastKnownGoodRelease);
    }
    throw new PublicSnapshotUnavailableError();
  }

  async readLogicalArtifact(
    logicalName: string,
  ): Promise<PublicLogicalArtifact | null> {
    if (!isSafeLogicalName(logicalName)) {
      throw new PublicSnapshotUnavailableError();
    }
    const candidates = await this.#candidateReleases();
    const active = candidates.find(({ source }) => source === "active");
    if (active && !(logicalName in active.manifest.artifacts)) return null;

    for (const release of candidates) {
      const descriptor = release.manifest.artifacts[logicalName];
      if (!descriptor) continue;
      try {
        const bytes = await this.#readArtifactBytes(descriptor);
        this.#lastKnownGoodRelease = release;
        return { logicalName, descriptor, bytes, release };
      } catch {
        // Try the pointer's previous immutable release as one whole fallback.
      }
    }
    if (this.#lastKnownGoodRelease) {
      const release = asLastKnownGood(this.#lastKnownGoodRelease);
      const descriptor = release.manifest.artifacts[logicalName];
      if (!descriptor) return null;
      try {
        return {
          logicalName,
          descriptor,
          bytes: await this.#readArtifactBytes(descriptor),
          release,
        };
      } catch {
        // Terminal controlled-unavailable below.
      }
    }
    throw new PublicSnapshotUnavailableError();
  }

  async readCanonicalState(): Promise<PublicCanonicalStateResult> {
    const candidates = await this.#candidateReleases();
    for (const release of candidates) {
      try {
        const state = await this.#readStateCached(release);
        const result = { state, release };
        this.#lastKnownGoodRelease = release;
        this.#lastKnownGoodState = result;
        return result;
      } catch {
        // Try the pointer's previous immutable release.
      }
    }
    if (this.#lastKnownGoodState) {
      return {
        state: this.#lastKnownGoodState.state,
        release: asLastKnownGood(this.#lastKnownGoodState.release),
      };
    }
    throw new PublicSnapshotUnavailableError();
  }

  async readItemBody(
    release: ResolvedPublicRelease,
    id: number,
  ): Promise<string | null> {
    const logicalName = publicItemBodyShardLogicalName(String(id));
    const descriptor = release.manifest.artifacts[logicalName];
    if (!descriptor) return null;
    const bytes = await this.#readArtifactBytes(descriptor);
    const shard = parsePublicItemBodyShardValue(logicalName, parseJson(bytes));
    return shard.entities.find((entity) => entity.id === id)?.bodyMd ?? null;
  }

  async #candidateReleases(): Promise<ResolvedPublicRelease[]> {
    let pointer: SnapshotPointer;
    try {
      const object = await this.#fetcher.read(CURRENT_POINTER_KEY, {
        immutable: false,
        maxBytes: POINTER_MAX_BYTES,
      });
      pointer = snapshotPointerSchema.parse(parseJson(object.bytes));
    } catch {
      return [];
    }

    const candidates: ResolvedPublicRelease[] = [];
    const refs: Array<{
      ref: SnapshotReleaseRef;
      source: Exclude<PublicSnapshotReadSource, "last-known-good">;
    }> = [{ ref: pointer.active, source: "active" }];
    if (pointer.previous) refs.push({ ref: pointer.previous, source: "previous" });
    for (const { ref, source } of refs) {
      try {
        const manifest = await this.#readManifest(ref);
        if (
          (source === "active" &&
            manifest.sourceWatermark !== pointer.sourceWatermark) ||
          (source === "previous" &&
            manifest.sourceWatermark > pointer.sourceWatermark)
        ) {
          continue;
        }
        candidates.push({ ref, manifest, pointer, source });
      } catch {
        // Corrupt/missing active is not terminal while previous or LKG exists.
      }
    }
    return candidates;
  }

  async #readManifest(ref: SnapshotReleaseRef): Promise<SnapshotManifest> {
    const cacheKey = `${ref.manifestKey}:${ref.manifestSha256}`;
    const cached = this.#manifestCache.get(cacheKey);
    if (cached) return cached;
    const loading = (async () => {
      const object = await this.#fetcher.read(ref.manifestKey, {
        immutable: true,
        maxBytes: MANIFEST_MAX_BYTES,
      });
      if ((await sha256Hex(object.bytes)) !== ref.manifestSha256) {
        throw new Error("public manifest hash mismatch");
      }
      const manifest = manifestSchema.parse(parseJson(object.bytes));
      if (manifest.releaseId !== ref.releaseId) {
        throw new Error("public manifest release mismatch");
      }
      return manifest;
    })();
    this.#manifestCache.set(cacheKey, loading);
    try {
      return await loading;
    } catch (error) {
      this.#manifestCache.delete(cacheKey);
      throw error;
    }
  }

  async #readArtifactBytes(
    descriptor: SnapshotArtifactDescriptor,
  ): Promise<Uint8Array> {
    const cacheKey = `${descriptor.key}:${descriptor.sha256}:${descriptor.byteLength}`;
    const cached = this.#artifactCache.get(cacheKey);
    if (cached) return (await cached).slice();
    const loading = (async () => {
      const object = await this.#fetcher.read(descriptor.key, {
        immutable: true,
        maxBytes: Math.min(ARTIFACT_MAX_BYTES, descriptor.byteLength),
      });
      if (
        object.bytes.byteLength !== descriptor.byteLength ||
        (await sha256Hex(object.bytes)) !== descriptor.sha256
      ) {
        throw new Error("public artifact integrity mismatch");
      }
      return object.bytes;
    })();
    this.#artifactCache.set(cacheKey, loading);
    try {
      return (await loading).slice();
    } catch (error) {
      this.#artifactCache.delete(cacheKey);
      throw error;
    }
  }

  async #readStateCached(
    release: ResolvedPublicRelease,
  ): Promise<ReturnType<typeof canonicalStateSchema.parse>> {
    const cacheKey = `${release.ref.releaseId}:${release.ref.manifestSha256}`;
    const cached = this.#stateCache.get(cacheKey);
    if (cached) return cached;
    const loading = this.#readStateFromRelease(release);
    this.#stateCache.set(cacheKey, loading);
    try {
      const state = await loading;
      while (this.#stateCache.size > STATE_CACHE_MAX_RELEASES) {
        const oldest = this.#stateCache.keys().next().value;
        if (oldest === undefined) break;
        this.#stateCache.delete(oldest);
      }
      return state;
    } catch (error) {
      this.#stateCache.delete(cacheKey);
      throw error;
    }
  }

  async #readStateFromRelease(
    release: ResolvedPublicRelease,
  ): Promise<ReturnType<typeof canonicalStateSchema.parse>> {
    const entries = Object.entries(release.manifest.artifacts)
      .filter(([logicalName]) => logicalName.startsWith("state/"))
      .sort(([left], [right]) => left.localeCompare(right));
    if (entries.length === 0 || entries.length > MAX_STATE_ARTIFACTS) {
      throw new Error("invalid public state shard inventory");
    }
    const shards = await mapWithConcurrency(
      entries,
      STATE_FETCH_CONCURRENCY,
      async ([logicalName, descriptor]) => {
        const bytes = await this.#readArtifactBytes(descriptor);
        return parsePublicEntityShardValue(logicalName, parseJson(bytes));
      },
    );
    const state = {
      schemaVersion: 1 as const,
      items: [] as unknown[],
      events: [] as unknown[],
      sources: [] as unknown[],
      newsletters: [] as unknown[],
      policies: [] as unknown[],
    };
    for (const shard of shards) {
      if (shard.entityType === "item") state.items.push(...shard.entities);
      else if (shard.entityType === "event") state.events.push(...shard.entities);
      else if (shard.entityType === "source") state.sources.push(...shard.entities);
      else if (shard.entityType === "newsletter") {
        state.newsletters.push(...shard.entities);
      } else state.policies.push(...shard.entities);
    }
    return canonicalStateSchema.parse(state);
  }
}

function asLastKnownGood(
  release: ResolvedPublicRelease,
): ResolvedPublicRelease {
  return { ...release, source: "last-known-good" };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await map(values[index]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
