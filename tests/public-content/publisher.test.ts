import { describe, expect, test } from "bun:test";
import { canonicalJsonBytes, sha256Hex } from "@/lib/public-content/canonical";
import {
  manifestSchema,
  snapshotPointerSchema,
} from "@/lib/public-content/contracts";
import {
  CURRENT_POINTER_KEY,
  objectKey,
  releaseManifestKey,
} from "@/lib/public-content/paths";
import { buildPublicRelease } from "@/lib/public-content/publisher/build-release";
import type {
  ImmutablePutInput,
  PointerCasInput,
  PublisherObjectStore,
  StoredPublisherObject,
} from "@/lib/public-content/publisher/object-store";
import { publishIncrementalSnapshot } from "@/lib/public-content/publisher/publish";
import type {
  PublicContentPublisherSource,
  PublicEntityChange,
  PublisherSourceBatch,
} from "@/lib/public-content/publisher/types";
import { canonicalState, item } from "./contract-fixtures";

const NOW = Date.parse("2026-07-14T12:00:00.000Z");

class FakeStore implements PublisherObjectStore {
  readonly objects = new Map<string, StoredPublisherObject>();
  readonly events: string[];
  casMode: "commit" | "conflict" | "throw_after_write" | "throw" = "commit";
  failNextImmutablePut = false;
  failManifestPut = false;
  corruptNextPutReadback = false;
  corruptManifestReadback = false;
  #etag = 0;
  #corruptKeys = new Set<string>();

  constructor(events: string[]) {
    this.events = events;
  }

  seed(key: string, bytes: Uint8Array, mediaType = "application/json"): void {
    this.objects.set(key, {
      bytes: bytes.slice(),
      etag: this.nextEtag(),
      mediaType,
      cacheControl: null,
    });
  }

  async readObject(key: string): Promise<StoredPublisherObject | null> {
    this.events.push(`read:${key}`);
    const value = this.objects.get(key);
    if (!value) return null;
    return {
      ...value,
      bytes: this.#corruptKeys.has(key)
        ? new TextEncoder().encode('{"corrupt":true}\n')
        : value.bytes.slice(),
    };
  }

  async putImmutable(input: ImmutablePutInput) {
    this.events.push(`put:${input.key}`);
    if (this.failNextImmutablePut) {
      this.failNextImmutablePut = false;
      throw new Error("injected immutable put failure");
    }
    if (this.failManifestPut && input.key.includes("/releases/")) {
      throw new Error("injected manifest put failure");
    }
    const existing = this.objects.get(input.key);
    if (existing) return { status: "reused" as const, etag: existing.etag };
    const etag = this.nextEtag();
    this.objects.set(input.key, {
      bytes: input.bytes.slice(),
      etag,
      mediaType: input.mediaType,
      cacheControl: input.cacheControl ?? null,
    });
    if (
      this.corruptNextPutReadback ||
      (this.corruptManifestReadback && input.key.includes("/releases/"))
    ) {
      this.#corruptKeys.add(input.key);
      this.corruptNextPutReadback = false;
    }
    return { status: "uploaded" as const, etag };
  }

  async compareAndSwapPointer(input: PointerCasInput) {
    this.events.push(`cas:${input.key}`);
    if (this.casMode === "conflict") {
      return { status: "conflict" as const, etag: null };
    }
    if (this.casMode === "throw") throw new Error("ambiguous CAS failure");
    const current = this.objects.get(input.key);
    if ((current?.etag ?? null) !== input.expectedEtag) {
      return { status: "conflict" as const, etag: null };
    }
    const etag = this.nextEtag();
    this.objects.set(input.key, {
      bytes: input.bytes.slice(),
      etag,
      mediaType: input.mediaType,
      cacheControl: input.cacheControl ?? null,
    });
    if (this.casMode === "throw_after_write") {
      throw new Error("ambiguous CAS after commit");
    }
    return { status: "committed" as const, etag };
  }

  clearEvents(): void {
    this.events.length = 0;
  }

  private nextEtag(): string {
    this.#etag += 1;
    return `"etag-${this.#etag}"`;
  }
}

class FakeSource implements PublicContentPublisherSource {
  ackCalls: number[] = [];
  failAckCount = 0;
  outboxIds: number[] = [];
  beforeAck: (() => void) | null = null;

  constructor(
    public batch: PublisherSourceBatch,
    readonly events: string[],
  ) {}

  async readBatch(fromWatermark: number): Promise<PublisherSourceBatch> {
    this.events.push(`source:${fromWatermark}`);
    return this.batch;
  }

  async acknowledgeThrough(highWater: number): Promise<void> {
    this.events.push(`ack:${highWater}`);
    this.ackCalls.push(highWater);
    this.beforeAck?.();
    this.beforeAck = null;
    if (this.failAckCount > 0) {
      this.failAckCount -= 1;
      throw new Error("injected ack failure");
    }
    this.outboxIds = this.outboxIds.filter((id) => id > highWater);
  }
}

async function seededFixture() {
  const events: string[] = [];
  const store = new FakeStore(events);
  const state = canonicalState();
  const changes = allChanges(state);
  const release = await buildPublicRelease({
    previousManifest: null,
    sourceWatermark: 10,
    changes,
    loadArtifact: async () => {
      throw new Error("bootstrap cannot load a prior artifact");
    },
  });
  for (const artifact of release.artifacts) {
    store.seed(artifact.descriptor.key, artifact.bytes);
  }
  store.seed(releaseManifestKey(release.releaseId), release.manifestBytes);
  const pointer = snapshotPointerSchema.parse({
    schemaVersion: 1,
    active: {
      releaseId: release.releaseId,
      manifestKey: releaseManifestKey(release.releaseId),
      manifestSha256: release.manifestSha256,
    },
    previous: null,
    publishedAt: new Date(NOW).toISOString(),
    sourceWatermark: 10,
  });
  store.seed(CURRENT_POINTER_KEY, canonicalJsonBytes(pointer));
  store.clearEvents();
  return { events, store, state, release, pointer };
}

function allChanges(
  state: ReturnType<typeof canonicalState>,
): PublicEntityChange[] {
  return [
    ...state.sources.map((value): PublicEntityChange => ({
      entityType: "source",
      entityKey: value.id,
      value,
    })),
    ...state.items.map((value): PublicEntityChange => ({
      entityType: "item",
      entityKey: String(value.id),
      value,
    })),
    ...state.events.map((value): PublicEntityChange => ({
      entityType: "event",
      entityKey: String(value.id),
      value,
    })),
    ...state.newsletters.map((value): PublicEntityChange => ({
      entityType: "newsletter",
      entityKey: String(value.id),
      value,
    })),
    ...state.policies.map((value): PublicEntityChange => ({
      entityType: "policy",
      entityKey: value.skillName,
      value,
    })),
  ];
}

function batch(
  from: number,
  to: number,
  changes: PublicEntityChange[],
): PublisherSourceBatch {
  return {
    fromWatermark: from,
    toWatermark: to,
    changes,
    telemetry: {
      candidateRows: changes.length,
      dedupedEntities: changes.length,
      returnedRows: changes.filter(({ value }) => value !== null).length,
      scannedRows: changes.length,
      scanMeasurementKind: "plan_upper_bound",
      queryCount: changes.length === 0 ? 1 : 3,
      verifiedPlans: ["public_content_outbox:integer-primary-key-range"],
    },
  };
}

function changedItem(
  state: ReturnType<typeof canonicalState>,
): PublicEntityChange {
  const value = {
    ...state.items[0]!,
    title: { ...state.items[0]!.title, en: "Changed title" },
  };
  return { entityType: "item", entityKey: String(value.id), value };
}

async function run(
  fixture: Awaited<ReturnType<typeof seededFixture>>,
  source: FakeSource,
) {
  return publishIncrementalSnapshot({
    source,
    store: fixture.store,
    runId: "run-11",
    now: () => NOW,
  });
}

describe("pointer-last incremental publisher", () => {
  test("uploads and validates content before manifest, then commits and acks", async () => {
    const fixture = await seededFixture();
    const source = new FakeSource(
      batch(10, 11, [changedItem(fixture.state)]),
      fixture.events,
    );
    source.outboxIds = [11];
    source.beforeAck = () => source.outboxIds.push(12);

    const receipt = await run(fixture, source);
    expect(receipt.status).toBe("succeeded");
    expect(receipt.objects.uploaded).toBe(1);
    expect(source.outboxIds).toEqual([12]);

    const contentPut = fixture.events.findIndex((event) =>
      event.startsWith("put:newsroom/v1/objects/"),
    );
    const manifestPut = fixture.events.findIndex((event) =>
      event.startsWith("put:newsroom/v1/releases/"),
    );
    const pointerCas = fixture.events.indexOf(`cas:${CURRENT_POINTER_KEY}`);
    const ack = fixture.events.indexOf("ack:11");
    expect(contentPut).toBeGreaterThan(-1);
    expect(contentPut).toBeLessThan(manifestPut);
    expect(manifestPut).toBeLessThan(pointerCas);
    expect(pointerCas).toBeLessThan(ack);
    expect(
      fixture.events.some((event) => event === `put:${CURRENT_POINTER_KEY}`),
    ).toBe(false);
  });

  test("no-change work checks the manifest layout but emits no release", async () => {
    const fixture = await seededFixture();
    const source = new FakeSource(batch(10, 10, []), fixture.events);
    source.outboxIds = [10];

    const receipt = await run(fixture, source);
    expect(receipt.status).toBe("noop");
    expect(receipt.releaseId).toBeNull();
    expect(source.outboxIds).toEqual([]);
    expect(fixture.events).toEqual([
      `read:${CURRENT_POINTER_KEY}`,
      "source:10",
      `read:${fixture.pointer.active.manifestKey}`,
      "ack:10",
    ]);
  });

  test("reuses identical content hashes but still advances the watermark", async () => {
    const fixture = await seededFixture();
    const unchanged = fixture.state.items[0]!;
    const source = new FakeSource(
      batch(10, 11, [
        {
          entityType: "item",
          entityKey: String(unchanged.id),
          value: unchanged,
        },
      ]),
      fixture.events,
    );

    const receipt = await run(fixture, source);
    expect(receipt.status).toBe("succeeded");
    expect(receipt.objects).toMatchObject({ uploaded: 0, reused: 1 });
    expect(
      fixture.events.filter((event) =>
        event.startsWith("put:newsroom/v1/objects/"),
      ),
    ).toEqual([]);
  });

  test("keeps the pointer and outbox untouched across pre-commit failures", async () => {
    const cases = [
      {
        stage: "upload_objects",
        configure: (store: FakeStore) => {
          store.failNextImmutablePut = true;
        },
      },
      {
        stage: "upload_objects",
        configure: (store: FakeStore) => {
          store.corruptNextPutReadback = true;
        },
      },
      {
        stage: "upload_manifest",
        configure: (store: FakeStore) => {
          store.failManifestPut = true;
        },
      },
      {
        stage: "upload_manifest",
        configure: (store: FakeStore) => {
          store.corruptManifestReadback = true;
        },
      },
      {
        stage: "advance_pointer",
        configure: (store: FakeStore) => {
          store.casMode = "conflict";
        },
      },
    ] as const;

    for (const scenario of cases) {
      const fixture = await seededFixture();
      const before = fixture.store.objects
        .get(CURRENT_POINTER_KEY)!
        .bytes.slice();
      const source = new FakeSource(
        batch(10, 11, [changedItem(fixture.state)]),
        fixture.events,
      );
      scenario.configure(fixture.store);

      const receipt = await run(fixture, source);
      expect(receipt.status, scenario.stage).toBe("failed");
      expect(receipt.failureStage, scenario.stage).toBe(scenario.stage);
      expect(source.ackCalls, scenario.stage).toEqual([]);
      expect(
        fixture.store.objects.get(CURRENT_POINTER_KEY)!.bytes,
        scenario.stage,
      ).toEqual(before);
    }
  });

  test("resolves an ambiguous CAS only when reread proves the intended release", async () => {
    const committed = await seededFixture();
    const committedSource = new FakeSource(
      batch(10, 11, [changedItem(committed.state)]),
      committed.events,
    );
    committed.store.casMode = "throw_after_write";
    expect((await run(committed, committedSource)).status).toBe("succeeded");
    expect(committedSource.ackCalls).toEqual([11]);

    const unknown = await seededFixture();
    const unknownSource = new FakeSource(
      batch(10, 11, [changedItem(unknown.state)]),
      unknown.events,
    );
    unknown.store.casMode = "throw";
    const failed = await run(unknown, unknownSource);
    expect(failed.failureStage).toBe("advance_pointer");
    expect(unknownSource.ackCalls).toEqual([]);
  });

  test("a committed ack failure retries as cleanup without a duplicate release", async () => {
    const fixture = await seededFixture();
    const source = new FakeSource(
      batch(10, 11, [changedItem(fixture.state)]),
      fixture.events,
    );
    source.failAckCount = 1;
    const first = await run(fixture, source);
    expect(first).toMatchObject({
      status: "failed",
      failureStage: "ack_outbox",
    });
    expect(first.releaseId).not.toBeNull();
    const committedPointer = snapshotPointerSchema.parse(
      JSON.parse(
        new TextDecoder().decode(
          fixture.store.objects.get(CURRENT_POINTER_KEY)!.bytes,
        ),
      ),
    );

    fixture.store.clearEvents();
    source.batch = batch(11, 11, []);
    const retry = await run(fixture, source);
    expect(retry.status).toBe("noop");
    expect(fixture.events).toEqual([
      `read:${CURRENT_POINTER_KEY}`,
      "source:11",
      `read:${committedPointer.active.manifestKey}`,
      "ack:11",
    ]);
    const after = snapshotPointerSchema.parse(
      JSON.parse(
        new TextDecoder().decode(
          fixture.store.objects.get(CURRENT_POINTER_KEY)!.bytes,
        ),
      ),
    );
    expect(after.active.releaseId).toBe(committedPointer.active.releaseId);
  });
});

describe("incremental release scale", () => {
  test("repartitions a legacy 128-bucket release before applying incremental work", async () => {
    const legacyItem = item(17);
    const legacyBytes = canonicalJsonBytes({
      schemaVersion: 1,
      entityType: "item",
      shard: { kind: "id_bucket", bucket: "11" },
      entities: [legacyItem],
    });
    const legacySha = await sha256Hex(legacyBytes);
    const legacyDescriptor = {
      key: objectKey(legacySha, "json"),
      sha256: legacySha,
      byteLength: legacyBytes.byteLength,
      mediaType: "application/json" as const,
      encoding: "utf-8" as const,
      shard: { kind: "id_bucket" as const, bucket: "11" },
    };
    const previous = manifestSchema.parse({
      schemaVersion: 1,
      releaseId: "r20-legacy",
      sourceWatermark: 20,
      artifacts: { "state/items/11": legacyDescriptor },
    });
    const migrated = await buildPublicRelease({
      previousManifest: previous,
      sourceWatermark: 21,
      changes: [],
      loadArtifact: async () => legacyBytes,
    });
    expect(migrated.loadedArtifactCount).toBe(1);
    expect(Object.keys(migrated.manifest.artifacts)).toEqual([
      "state/items/01",
    ]);
    expect(migrated.artifacts).toHaveLength(1);
    expect(
      JSON.parse(new TextDecoder().decode(migrated.artifacts[0]!.bytes))
        .entities[0].id,
    ).toBe(17);
  });

  test("loads only touched stable shards, independent of unrelated corpus descriptors", async () => {
    const initialChanges = Array.from({ length: 100 }, (_, index) => {
      const value = item(index + 1);
      return {
        entityType: "item" as const,
        entityKey: String(value.id),
        value,
      };
    });
    const initial = await buildPublicRelease({
      previousManifest: null,
      sourceWatermark: 20,
      changes: initialChanges,
      loadArtifact: async () => {
        throw new Error("no prior release");
      },
    });
    const bytesByKey = new Map(
      initial.artifacts.map((artifact) => [
        artifact.descriptor.key,
        artifact.bytes,
      ]),
    );
    const filler = initial.artifacts[0]!.descriptor;
    const unrelated = Object.fromEntries(
      Array.from({ length: 2_000 }, (_, index) => [
        `derived/cache/${String(index).padStart(4, "0")}`,
        filler,
      ]),
    );
    const previous = manifestSchema.parse({
      ...initial.manifest,
      artifacts: { ...initial.manifest.artifacts, ...unrelated },
    });
    const loadCounts: number[] = [];
    const build = (changes: PublicEntityChange[]) =>
      buildPublicRelease({
        previousManifest: previous,
        sourceWatermark: 21,
        changes,
        loadArtifact: async (_name, descriptor) => {
          loadCounts[0] = (loadCounts[0] ?? 0) + 1;
          return bytesByKey.get(descriptor.key)!;
        },
      });

    const one = await build([
      {
        ...initialChanges[0]!,
        value: {
          ...initialChanges[0]!.value,
          title: { raw: "one", zh: null, en: "one" },
        },
      },
    ]);
    expect(one.loadedArtifactCount).toBe(1);
    expect(one.artifacts).toHaveLength(1);

    loadCounts[0] = 0;
    const hundred = await build(
      initialChanges.map((change) => ({
        ...change,
        value: {
          ...change.value,
          title: { raw: `changed-${change.entityKey}`, zh: null, en: null },
        },
      })),
    );
    expect(hundred.loadedArtifactCount).toBe(16);
    expect(hundred.artifacts).toHaveLength(16);
    expect(loadCounts[0]).toBe(16);

    const repeated = await build(
      initialChanges.map((change) => ({
        ...change,
        value: {
          ...change.value,
          title: { raw: `changed-${change.entityKey}`, zh: null, en: null },
        },
      })),
    );
    expect(repeated.releaseId).toBe(hundred.releaseId);
    expect(repeated.manifestBytes).toEqual(hundred.manifestBytes);
    expect(await sha256Hex(repeated.manifestBytes)).toBe(
      await sha256Hex(hundred.manifestBytes),
    );
  });
});
