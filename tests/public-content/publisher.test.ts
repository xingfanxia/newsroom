import { describe, expect, test } from "bun:test";
import { canonicalJsonBytes, sha256Hex } from "@/lib/public-content/canonical";
import {
  canonicalStateSchema,
  manifestSchema,
  parsePublicEntityShardValue,
  parsePublicItemBodyShardValue,
  PUBLIC_NUMERIC_SHARD_COUNT,
  publicItemBodyShardLogicalName,
  publicItemSchema,
  snapshotPointerSchema,
} from "@/lib/public-content/contracts";
import {
  materializedPageLogicalName,
  parseMaterializedPageArtifact,
} from "@/lib/public-content/materialized-artifact";
import {
  CURRENT_POINTER_KEY,
  objectKey,
  releaseManifestKey,
  runReceiptKey,
} from "@/lib/public-content/paths";
import { buildPublicRelease } from "@/lib/public-content/publisher/build-release";
import type {
  ImmutablePutInput,
  PointerCasInput,
  PublisherObjectStore,
  StoredPublisherObject,
} from "@/lib/public-content/publisher/object-store";
import { publishIncrementalSnapshot } from "@/lib/public-content/publisher/publish";
import { runIncrementalPublicPublisher } from "@/lib/public-content/publisher/runtime";
import type {
  PublicContentPublisherSource,
  PublicEntityChange,
  PublisherSourceBatch,
} from "@/lib/public-content/publisher/types";
import { swapPublicPointerToPrevious } from "@/lib/public-content/publisher/rollback-pointer";
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

async function seededFixture(
  state: ReturnType<typeof canonicalStateSchema.parse> =
    canonicalStateSchema.parse(canonicalState()),
) {
  const events: string[] = [];
  const store = new FakeStore(events);
  const changes = allChanges(state);
  const release = await buildPublicRelease({
    previousManifest: null,
    sourceWatermark: 10,
    changes,
    generatedAtMs: NOW,
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

function artifactBytesByKey(
  release: Awaited<ReturnType<typeof buildPublicRelease>>,
): Map<string, Uint8Array> {
  return new Map(
    release.artifacts.map((artifact) => [
      artifact.descriptor.key,
      artifact.bytes,
    ]),
  );
}

function loadFromRelease(
  release: Awaited<ReturnType<typeof buildPublicRelease>>,
  loadedLogicalNames: string[] = [],
) {
  const bytesByKey = artifactBytesByKey(release);
  return async (logicalName: string, descriptor: { key: string }) => {
    loadedLogicalNames.push(logicalName);
    const bytes = bytesByKey.get(descriptor.key);
    if (!bytes) throw new Error(`missing fixture artifact: ${logicalName}`);
    return bytes;
  };
}

async function jsonFixtureArtifact(
  value: unknown,
  shard:
    | { kind: "id_bucket"; bucket: string }
    | { kind: "singleton" },
) {
  const bytes = canonicalJsonBytes(value);
  const sha256 = await sha256Hex(bytes);
  return {
    bytes,
    descriptor: {
      key: objectKey(sha256, "json"),
      sha256,
      byteLength: bytes.byteLength,
      mediaType: "application/json" as const,
      encoding: "utf-8" as const,
      shard,
    },
  };
}

async function downgradeToLegacyFatItems(
  fixture: Awaited<ReturnType<typeof seededFixture>>,
) {
  const bodyById = new Map(
    fixture.state.items.map(({ id, bodyMd }) => [id, bodyMd] as const),
  );
  const artifacts = Object.fromEntries(
    Object.entries(fixture.release.manifest.artifacts).filter(
      ([logicalName]) => !logicalName.startsWith("bodies/items/"),
    ),
  );
  for (const [logicalName, descriptor] of Object.entries(artifacts)) {
    if (!logicalName.startsWith("state/items/")) continue;
    const stored = fixture.store.objects.get(descriptor.key);
    if (!stored) throw new Error(`missing fixture state shard: ${logicalName}`);
    const shard = parsePublicEntityShardValue(
      logicalName,
      JSON.parse(new TextDecoder().decode(stored.bytes)) as unknown,
    );
    const bytes = canonicalJsonBytes({
      ...shard,
      entities: shard.entities.map((entity) => {
        const parsed = publicItemSchema.parse(entity);
        return { ...parsed, bodyMd: bodyById.get(parsed.id) ?? null };
      }),
    });
    const sha256 = await sha256Hex(bytes);
    const fatDescriptor = {
      ...descriptor,
      key: objectKey(sha256, "json"),
      sha256,
      byteLength: bytes.byteLength,
    };
    artifacts[logicalName] = fatDescriptor;
    fixture.store.seed(fatDescriptor.key, bytes);
  }
  const releaseId = `r${fixture.release.manifest.sourceWatermark}-legacy-fat`;
  const manifest = manifestSchema.parse({
    ...fixture.release.manifest,
    releaseId,
    artifacts,
  });
  const manifestBytes = canonicalJsonBytes(manifest);
  const manifestSha256 = await sha256Hex(manifestBytes);
  const manifestKey = releaseManifestKey(releaseId);
  fixture.store.seed(manifestKey, manifestBytes);
  const pointer = snapshotPointerSchema.parse({
    ...fixture.pointer,
    active: { releaseId, manifestKey, manifestSha256 },
  });
  fixture.store.seed(CURRENT_POINTER_KEY, canonicalJsonBytes(pointer));
  fixture.store.clearEvents();
  return { manifest, pointer };
}

function allChanges(
  state: ReturnType<typeof canonicalStateSchema.parse>,
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
  state: ReturnType<typeof canonicalStateSchema.parse>,
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

async function runRuntime(
  fixture: Awaited<ReturnType<typeof seededFixture>>,
  source: FakeSource,
  runId: string,
) {
  return runIncrementalPublicPublisher({
    source,
    store: fixture.store,
    runId,
    now: () => NOW,
  });
}

function bucketFanoutChanges(
  state: ReturnType<typeof canonicalStateSchema.parse>,
  newsletterCount: number,
): PublicEntityChange[] {
  const seedItem = state.items[0]!;
  const seedEvent = state.events[0]!;
  const seedNewsletter = state.newsletters[0]!;
  if (seedNewsletter.format !== "daily_column") {
    throw new Error("expected daily-column fixture");
  }
  const changes: PublicEntityChange[] = [];
  for (let id = 1; id <= 248; id += 1) {
    changes.push({
      entityType: "item",
      entityKey: String(id),
      value: {
        ...seedItem,
        id,
        eventId: Math.ceil(id / 2),
        title: { ...seedItem.title, raw: `Item ${id}` },
        url: `https://example.com/items/${id}`,
        canonicalUrl: `https://example.com/items/${id}`,
      },
    });
  }
  for (let id = 1; id <= 124; id += 1) {
    const leadItemId = id * 2 - 1;
    changes.push({
      entityType: "event",
      entityKey: String(id),
      value: {
        ...seedEvent,
        id,
        leadItemId,
        memberItemIds: [leadItemId, leadItemId + 1],
        coverage: 2,
      },
    });
  }
  for (let id = 1; id <= newsletterCount; id += 1) {
    changes.push({
      entityType: "newsletter",
      entityKey: String(id),
      value: {
        ...seedNewsletter,
        id,
        itemIds: [1],
        featuredItemIds: [1],
      },
    });
  }
  return changes;
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
    expect(receipt.objects.uploaded).toBeGreaterThan(1);
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

  test("conditionally swaps to the validated previous release and can restore", async () => {
    const fixture = await seededFixture();
    const source = new FakeSource(
      batch(10, 11, [changedItem(fixture.state)]),
      fixture.events,
    );
    const published = await run(fixture, source);
    expect(published.status).toBe("succeeded");

    const rollback = await swapPublicPointerToPrevious(
      fixture.store,
      () => NOW + 1,
    );
    expect(rollback).toMatchObject({
      fromReleaseId: published.releaseId,
      rollbackReleaseId: fixture.release.releaseId,
      conditionalPointerReplace: true,
      sourceWatermark: 10,
    });
    const restore = await swapPublicPointerToPrevious(
      fixture.store,
      () => NOW + 2,
    );
    expect(restore.fromReleaseId).toBe(fixture.release.releaseId);
    expect(restore.rollbackReleaseId).toBe(published.releaseId!);
    expect(restore.sourceWatermark).toBe(11);
    expect(restore.pointerEtagAfter).not.toBe(rollback.pointerEtagAfter);
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
    expect(receipt.objects.uploaded).toBe(0);
    expect(receipt.objects.reused).toBeGreaterThan(1);
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

  test("publishes exactly 497 changed artifacts within the 500-write runtime cap", async () => {
    const fixture = await seededFixture();
    const changes = bucketFanoutChanges(fixture.state, 87);
    const candidate = await buildPublicRelease({
      previousManifest: fixture.release.manifest,
      sourceWatermark: 10 + changes.length,
      changes,
      generatedAtMs: NOW,
      loadArtifact: async (logicalName, descriptor) => {
        const stored = fixture.store.objects.get(descriptor.key);
        if (!stored) throw new Error(`missing fixture artifact: ${logicalName}`);
        return stored.bytes;
      },
    });
    expect(
      candidate.artifacts.filter(({ unchanged }) => !unchanged),
    ).toHaveLength(497);
    const source = new FakeSource(
      batch(10, 10 + changes.length, changes),
      fixture.events,
    );
    const runId = "run-at-write-cap";

    const receipt = await runRuntime(fixture, source, runId);

    expect(receipt).toMatchObject({ status: "succeeded", failureStage: null });
    expect(source.ackCalls).toEqual([10 + changes.length]);
    expect(
      fixture.events.filter(
        (event) => event.startsWith("put:") || event.startsWith("cas:"),
      ),
    ).toHaveLength(500);
    expect(fixture.events).toContain(
      `put:${runReceiptKey("2026-07-14", runId)}`,
    );
  });

  test("rejects 498 changed artifacts before runtime writes only its receipt", async () => {
    const fixture = await seededFixture();
    const changes = bucketFanoutChanges(fixture.state, 88);
    const candidate = await buildPublicRelease({
      previousManifest: fixture.release.manifest,
      sourceWatermark: 10 + changes.length,
      changes,
      generatedAtMs: NOW,
      loadArtifact: async (logicalName, descriptor) => {
        const stored = fixture.store.objects.get(descriptor.key);
        if (!stored) throw new Error(`missing fixture artifact: ${logicalName}`);
        return stored.bytes;
      },
    });
    expect(
      candidate.artifacts.filter(({ unchanged }) => !unchanged),
    ).toHaveLength(498);
    const source = new FakeSource(
      batch(10, 10 + changes.length, changes),
      fixture.events,
    );
    const runId = "run-over-write-cap";

    const receipt = await runRuntime(fixture, source, runId);

    expect(receipt).toMatchObject({
      status: "failed",
      failureStage: "upload_objects",
      objects: { uploaded: 0, reused: 0 },
    });
    expect(source.ackCalls).toEqual([]);
    expect(
      fixture.events.filter(
        (event) => event.startsWith("put:") || event.startsWith("cas:"),
      ),
    ).toEqual([`put:${runReceiptKey("2026-07-14", runId)}`]);
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
  test("patches the matching slim and body shards without rebuilding unrelated buckets", async () => {
    const first = item(1);
    const second = item(2);
    const initial = await buildPublicRelease({
      previousManifest: null,
      sourceWatermark: 20,
      changes: [first, second].map((value) => ({
        entityType: "item" as const,
        entityKey: String(value.id),
        value,
      })),
      loadArtifact: async () => {
        throw new Error("bootstrap cannot load a prior artifact");
      },
    });
    expect(
      Object.keys(initial.manifest.artifacts).filter((logicalName) =>
        logicalName.startsWith("bodies/items/"),
      ),
    ).toHaveLength(PUBLIC_NUMERIC_SHARD_COUNT);

    const changed = {
      ...first,
      title: { ...first.title, en: "Changed title" },
      bodyMd: "Changed body bytes",
    };
    const next = await buildPublicRelease({
      previousManifest: initial.manifest,
      sourceWatermark: 21,
      changes: [
        {
          entityType: "item",
          entityKey: String(changed.id),
          value: changed,
        },
      ],
      loadArtifact: loadFromRelease(initial),
    });
    expect(next.loadedArtifactCount).toBe(2);
    expect(next.artifacts.map(({ logicalName }) => logicalName).sort()).toEqual([
      "bodies/items/01",
      "state/items/01",
    ]);
    expect(next.artifacts.every(({ unchanged }) => !unchanged)).toBe(true);
    const slim = next.artifacts.find(
      ({ logicalName }) => logicalName === "state/items/01",
    )!;
    expect(
      parsePublicEntityShardValue(
        slim.logicalName,
        JSON.parse(new TextDecoder().decode(slim.bytes)) as unknown,
      ).entities[0],
    ).toMatchObject({ id: 1, bodyMd: null, title: changed.title });
    const body = next.artifacts.find(
      ({ logicalName }) => logicalName === "bodies/items/01",
    )!;
    expect(
      parsePublicItemBodyShardValue(
        body.logicalName,
        JSON.parse(new TextDecoder().decode(body.bytes)) as unknown,
      ).entities,
    ).toEqual([{ id: 1, bodyMd: "Changed body bytes" }]);
    expect(next.manifest.artifacts["state/items/02"]!.sha256).toBe(
      initial.manifest.artifacts["state/items/02"]!.sha256,
    );
    expect(next.manifest.artifacts["bodies/items/02"]!.sha256).toBe(
      initial.manifest.artifacts["bodies/items/02"]!.sha256,
    );
  });

  test("removes item bodies when the body is cleared or the item is deleted", async () => {
    const value = item(1);
    const initial = await buildPublicRelease({
      previousManifest: null,
      sourceWatermark: 20,
      changes: [{ entityType: "item", entityKey: "1", value }],
      loadArtifact: async () => {
        throw new Error("bootstrap cannot load a prior artifact");
      },
    });
    for (const change of [
      { entityType: "item" as const, entityKey: "1", value: { ...value, bodyMd: null } },
      { entityType: "item" as const, entityKey: "1", value: null },
    ]) {
      const next = await buildPublicRelease({
        previousManifest: initial.manifest,
        sourceWatermark: 21,
        changes: [change],
        loadArtifact: loadFromRelease(initial),
      });
      const body = next.artifacts.find(
        ({ logicalName }) => logicalName === "bodies/items/01",
      )!;
      expect(
        parsePublicItemBodyShardValue(
          body.logicalName,
          JSON.parse(new TextDecoder().decode(body.bytes)) as unknown,
        ).entities,
      ).toEqual([]);
      const slim = next.artifacts.find(
        ({ logicalName }) => logicalName === "state/items/01",
      )!;
      const slimEntities = parsePublicEntityShardValue(
        slim.logicalName,
        JSON.parse(new TextDecoder().decode(slim.bytes)) as unknown,
      ).entities;
      if (change.value === null) expect(slimEntities).toEqual([]);
      else expect(slimEntities[0]).toMatchObject({ id: 1, bodyMd: null });
    }
  });

  test("forces a zero-change legacy migration and preserves podcast detail bodies", async () => {
    const fixtureState = canonicalState();
    const state = canonicalStateSchema.parse({
      ...fixtureState,
      items: Array.from({ length: PUBLIC_NUMERIC_SHARD_COUNT }, (_, index) => {
        const id = index + 1;
        return {
          ...item(id),
          eventId: null,
          url: `https://example.com/podcast/${id}`,
          canonicalUrl: `https://example.com/podcast/${id}`,
        };
      }),
      events: [],
      newsletters: [],
      sources: fixtureState.sources.map((value) => ({
        ...value,
        group: "podcast",
      })),
    });
    const rebuiltFixture = await seededFixture(state);
    const expectedBody = state.items[0]!.bodyMd!;
    const legacy = await downgradeToLegacyFatItems(rebuiltFixture);
    expect(
      Object.keys(legacy.manifest.artifacts).filter((logicalName) =>
        logicalName.startsWith("state/items/"),
      ),
    ).toHaveLength(PUBLIC_NUMERIC_SHARD_COUNT);
    const source = new FakeSource(batch(10, 10, []), rebuiltFixture.events);

    const receipt = await runRuntime(
      rebuiltFixture,
      source,
      "run-full-body-split-migration",
    );
    expect(receipt).toMatchObject({ status: "succeeded", failureStage: null });
    expect(
      rebuiltFixture.events.filter(
        (event) => event.startsWith("put:") || event.startsWith("cas:"),
      ),
    ).toHaveLength(259);
    const pointer = snapshotPointerSchema.parse(
      JSON.parse(
        new TextDecoder().decode(
          rebuiltFixture.store.objects.get(CURRENT_POINTER_KEY)!.bytes,
        ),
      ),
    );
    const manifest = manifestSchema.parse(
      JSON.parse(
        new TextDecoder().decode(
          rebuiltFixture.store.objects.get(pointer.active.manifestKey)!.bytes,
        ),
      ),
    );
    expect(
      Object.keys(manifest.artifacts).filter((logicalName) =>
        logicalName.startsWith("bodies/items/"),
      ),
    ).toHaveLength(PUBLIC_NUMERIC_SHARD_COUNT);
    for (const [logicalName, descriptor] of Object.entries(
      manifest.artifacts,
    )) {
      if (!logicalName.startsWith("state/items/")) continue;
      const shard = parsePublicEntityShardValue(
        logicalName,
        JSON.parse(
          new TextDecoder().decode(
            rebuiltFixture.store.objects.get(descriptor.key)!.bytes,
          ),
        ) as unknown,
      );
      if (shard.entityType !== "item") {
        throw new Error(`unexpected fixture shard: ${logicalName}`);
      }
      expect(shard.entities.every((entity) => entity.bodyMd === null)).toBe(
        true,
      );
    }
    const bodyLogicalName = publicItemBodyShardLogicalName("1");
    const bodyDescriptor = manifest.artifacts[bodyLogicalName]!;
    expect(
      parsePublicItemBodyShardValue(
        bodyLogicalName,
        JSON.parse(
          new TextDecoder().decode(
            rebuiltFixture.store.objects.get(bodyDescriptor.key)!.bytes,
          ),
        ) as unknown,
      ).entities,
    ).toContainEqual({ id: 1, bodyMd: expectedBody });
    const detailDescriptor =
      manifest.artifacts[materializedPageLogicalName.podcastDetails(1)]!;
    const detail = parseMaterializedPageArtifact<{
      detailsById: Record<
        string,
        { en: { bodyMd: string | null }; zh: { bodyMd: string | null } }
      >;
    }>(rebuiltFixture.store.objects.get(detailDescriptor.key)!.bytes);
    expect(detail.model.detailsById["1"]!.en.bodyMd).toBe(
      expectedBody,
    );
    expect(detail.model.detailsById["1"]!.zh.bodyMd).toBe(
      expectedBody,
    );
  });

  test("loads only podcast body buckets when rematerializing an existing split release", async () => {
    const fixtureState = canonicalState();
    const state = canonicalStateSchema.parse({
      ...fixtureState,
      sources: fixtureState.sources.map((value) => ({
        ...value,
        group: "podcast",
      })),
    });
    const initial = await buildPublicRelease({
      previousManifest: null,
      sourceWatermark: 20,
      changes: allChanges(state),
      generatedAtMs: NOW,
      loadArtifact: async () => {
        throw new Error("bootstrap cannot load a prior artifact");
      },
    });
    const expectedBody = state.items[0]!.bodyMd!;
    const loadedLogicalNames: string[] = [];
    const changedSource = {
      ...state.sources[0]!,
      name: { ...state.sources[0]!.name, en: "Changed podcast" },
    };
    const next = await buildPublicRelease({
      previousManifest: initial.manifest,
      sourceWatermark: 21,
      changes: [
        {
          entityType: "source",
          entityKey: changedSource.id,
          value: changedSource,
        },
      ],
      generatedAtMs: NOW + 1,
      loadArtifact: loadFromRelease(initial, loadedLogicalNames),
    });
    expect(
      loadedLogicalNames
        .filter((logicalName) => logicalName.startsWith("bodies/items/"))
        .sort(),
    ).toEqual(["bodies/items/01", "bodies/items/02"]);
    const detail = next.artifacts.find(
      ({ logicalName }) =>
        logicalName === materializedPageLogicalName.podcastDetails(1),
    )!;
    const parsed = parseMaterializedPageArtifact<{
      detailsById: Record<string, { en: { bodyMd: string | null } }>;
    }>(detail.bytes);
    expect(parsed.model.detailsById["1"]!.en.bodyMd).toBe(
      expectedBody,
    );
  });

  test("preserves full canonical state through combined 16-bucket and body-split migration", async () => {
    const base = canonicalState();
    const legacyState = canonicalStateSchema.parse({
      ...base,
      items: [
        { ...item(17), eventId: 7 },
        { ...item(34), eventId: 7 },
      ],
      events: [
        {
          ...base.events[0]!,
          leadItemId: 17,
          memberItemIds: [17, 34],
        },
      ],
      newsletters: [
        {
          ...base.newsletters[0]!,
          itemIds: [34, 17],
          featuredItemIds: [17],
        },
      ],
    });
    const legacyShardValues = new Map<string, unknown>([
      [
        "state/items/01",
        {
          schemaVersion: 1,
          entityType: "item",
          shard: { kind: "id_bucket", bucket: "01" },
          entities: [legacyState.items[0]],
        },
      ],
      [
        "state/items/02",
        {
          schemaVersion: 1,
          entityType: "item",
          shard: { kind: "id_bucket", bucket: "02" },
          entities: [legacyState.items[1]],
        },
      ],
      [
        "state/events/07",
        {
          schemaVersion: 1,
          entityType: "event",
          shard: { kind: "id_bucket", bucket: "07" },
          entities: legacyState.events,
        },
      ],
      [
        "state/newsletters/04",
        {
          schemaVersion: 1,
          entityType: "newsletter",
          shard: { kind: "id_bucket", bucket: "04" },
          entities: legacyState.newsletters,
        },
      ],
      [
        "state/sources",
        {
          schemaVersion: 1,
          entityType: "source",
          shard: { kind: "singleton" },
          entities: legacyState.sources,
        },
      ],
      [
        "state/policies",
        {
          schemaVersion: 1,
          entityType: "policy",
          shard: { kind: "singleton" },
          entities: legacyState.policies,
        },
      ],
    ]);
    const legacyArtifacts: Record<
      string,
      Awaited<ReturnType<typeof jsonFixtureArtifact>>["descriptor"]
    > = {};
    const legacyBytesByKey = new Map<string, Uint8Array>();
    for (const [logicalName, value] of legacyShardValues) {
      const shard = logicalName === "state/sources" || logicalName === "state/policies"
        ? { kind: "singleton" as const }
        : { kind: "id_bucket" as const, bucket: logicalName.slice(-2) };
      const artifact = await jsonFixtureArtifact(value, shard);
      legacyArtifacts[logicalName] = artifact.descriptor;
      legacyBytesByKey.set(artifact.descriptor.key, artifact.bytes);
    }
    const previous = manifestSchema.parse({
      schemaVersion: 1,
      releaseId: "r20-legacy",
      sourceWatermark: 20,
      numericShardCount: 16,
      artifacts: legacyArtifacts,
    });
    const migrated = await buildPublicRelease({
      previousManifest: previous,
      sourceWatermark: 21,
      changes: [],
      loadArtifact: async (logicalName, descriptor) => {
        const bytes = legacyBytesByKey.get(descriptor.key);
        if (!bytes) throw new Error(`missing legacy fixture: ${logicalName}`);
        return bytes;
      },
    });
    expect(migrated.loadedArtifactCount).toBe(4);
    expect(migrated.manifest.artifacts["state/items/11"]).toBeDefined();
    expect(migrated.manifest.artifacts["state/items/22"]).toBeDefined();
    expect(
      Object.keys(migrated.manifest.artifacts).filter((logicalName) =>
        logicalName.startsWith("bodies/items/"),
      ),
    ).toHaveLength(PUBLIC_NUMERIC_SHARD_COUNT);
    expect(migrated.artifacts).toHaveLength(
      PUBLIC_NUMERIC_SHARD_COUNT + 4,
    );

    const migratedBytesByKey = new Map([
      ...legacyBytesByKey,
      ...artifactBytesByKey(migrated),
    ]);
    const reconstructed = {
      schemaVersion: 1 as const,
      items: [] as unknown[],
      events: [] as unknown[],
      sources: [] as unknown[],
      newsletters: [] as unknown[],
      policies: [] as unknown[],
    };
    const bodiesById = new Map<number, string>();
    for (const [logicalName, descriptor] of Object.entries(
      migrated.manifest.artifacts,
    )) {
      const bytes = migratedBytesByKey.get(descriptor.key)!;
      if (logicalName.startsWith("bodies/items/")) {
        for (const body of parsePublicItemBodyShardValue(
          logicalName,
          JSON.parse(new TextDecoder().decode(bytes)) as unknown,
        ).entities) {
          bodiesById.set(body.id, body.bodyMd);
        }
        continue;
      }
      if (!logicalName.startsWith("state/")) continue;
      const shard = parsePublicEntityShardValue(
        logicalName,
        JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      );
      if (shard.entityType === "item") reconstructed.items.push(...shard.entities);
      else if (shard.entityType === "event") reconstructed.events.push(...shard.entities);
      else if (shard.entityType === "source") reconstructed.sources.push(...shard.entities);
      else if (shard.entityType === "newsletter") reconstructed.newsletters.push(...shard.entities);
      else reconstructed.policies.push(...shard.entities);
    }
    reconstructed.items = reconstructed.items.map((value) => {
      const parsed = publicItemSchema.parse(value);
      return { ...parsed, bodyMd: bodiesById.get(parsed.id) ?? null };
    });
    const restoredState = canonicalStateSchema.parse(reconstructed);
    expect(restoredState).toEqual(legacyState);
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
    expect(one.loadedArtifactCount).toBe(2);
    expect(one.artifacts).toHaveLength(2);

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
    expect(hundred.loadedArtifactCount).toBe(200);
    expect(hundred.artifacts).toHaveLength(200);
    expect(loadCounts[0]).toBe(200);

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
