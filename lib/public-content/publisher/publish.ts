import { z } from "zod";
import { canonicalJsonBytes, sha256Hex } from "@/lib/public-content/canonical";
import {
  manifestSchema,
  parsePublicEntityShardValue,
  runReceiptSchema,
  snapshotPointerSchema,
} from "@/lib/public-content/contracts";
import {
  CURRENT_POINTER_KEY,
  releaseManifestKey,
} from "@/lib/public-content/paths";
import {
  buildPublicRelease,
  verifyDescriptorBytes,
  type BuiltPublicRelease,
  type PublicReleaseManifest,
} from "./build-release";
import {
  IMMUTABLE_PUBLIC_CACHE_CONTROL,
  POINTER_PUBLIC_CACHE_CONTROL,
  type PublisherObjectStore,
} from "./object-store";
import type {
  PublicContentPublisherSource,
  PublicEntityChange,
  PublisherSourceBatch,
} from "./types";

type SnapshotPointer = z.infer<typeof snapshotPointerSchema>;
export type PublicPublisherReceipt = z.infer<typeof runReceiptSchema>;

export type IncrementalPublishInput = {
  source: PublicContentPublisherSource;
  store: PublisherObjectStore;
  runId: string;
  now?: () => number;
};

export type PublicPublisherObjectMetrics = {
  uploaded: number;
  reused: number;
  uploadedBytes: number;
  reusedBytes: number;
};

type ReceiptContext = {
  runId: string;
  startedAtMs: number;
  now: () => number;
  batch: PublisherSourceBatch | null;
  fromWatermark: number;
  objects: PublicPublisherObjectMetrics;
};

export async function publishIncrementalSnapshot(
  input: IncrementalPublishInput,
): Promise<PublicPublisherReceipt> {
  const now = input.now ?? Date.now;
  const context: ReceiptContext = {
    runId: input.runId,
    startedAtMs: now(),
    now,
    batch: null,
    fromWatermark: 0,
    objects: emptyPublicPublisherObjectMetrics(),
  };

  let current: PointerRecord;
  try {
    current = await requireCurrentPointer(input.store);
    context.fromWatermark = current.pointer.sourceWatermark;
  } catch {
    return receipt(context, "failed", "build_state", null);
  }

  try {
    context.batch = await input.source.readBatch(
      current.pointer.sourceWatermark,
    );
    validateBatch(context.batch, current.pointer.sourceWatermark);
  } catch {
    return receipt(context, "failed", "read_outbox", null);
  }

  if (context.batch.changes.length === 0) {
    try {
      await input.source.acknowledgeThrough(context.batch.toWatermark);
      return receipt(context, "noop", null, null);
    } catch {
      return receipt(
        context,
        "failed",
        "ack_outbox",
        current.pointer.active.releaseId,
      );
    }
  }

  let previousManifest: PublicReleaseManifest;
  try {
    previousManifest = await readActiveManifest(input.store, current.pointer);
  } catch {
    return receipt(context, "failed", "build_state", null);
  }

  let release: BuiltPublicRelease;
  try {
    release = await buildPublicRelease({
      previousManifest,
      sourceWatermark: context.batch.toWatermark,
      changes: context.batch.changes,
      loadArtifact: async (_logicalName, descriptor) => {
        const stored = await input.store.readObject(descriptor.key);
        if (!stored) throw new Error(`missing prior artifact: ${descriptor.key}`);
        return stored.bytes;
      },
    });
  } catch {
    return receipt(context, "failed", "derive", null);
  }

  try {
    await uploadChangedReleaseArtifacts(input.store, release, context.objects);
  } catch {
    return receipt(context, "failed", "upload_objects", null);
  }

  try {
    await uploadAndVerifyReleaseManifest(input.store, release);
  } catch {
    return receipt(context, "failed", "upload_manifest", null);
  }

  const nextPointer = snapshotPointerSchema.parse({
    schemaVersion: 1,
    active: {
      releaseId: release.releaseId,
      manifestKey: releaseManifestKey(release.releaseId),
      manifestSha256: release.manifestSha256,
    },
    previous: current.pointer.active,
    publishedAt: iso(now()),
    sourceWatermark: context.batch.toWatermark,
  });
  const pointerBytes = canonicalJsonBytes(nextPointer);
  const committed = await commitSnapshotPointer(
    input.store,
    current.etag,
    nextPointer,
    pointerBytes,
  );
  if (!committed) {
    return receipt(context, "failed", "advance_pointer", null);
  }

  try {
    await input.source.acknowledgeThrough(context.batch.toWatermark);
  } catch {
    return receipt(
      context,
      "failed",
      "ack_outbox",
      release.releaseId,
    );
  }
  return receipt(context, "succeeded", null, release.releaseId);
}

type PointerRecord = {
  pointer: SnapshotPointer;
  etag: string;
};

async function requireCurrentPointer(
  store: PublisherObjectStore,
): Promise<PointerRecord> {
  const object = await store.readObject(CURRENT_POINTER_KEY);
  if (!object) throw new Error("public snapshot pointer is missing");
  return {
    pointer: snapshotPointerSchema.parse(parseJson(object.bytes)),
    etag: object.etag,
  };
}

async function readActiveManifest(
  store: PublisherObjectStore,
  pointer: SnapshotPointer,
): Promise<PublicReleaseManifest> {
  const object = await store.readObject(pointer.active.manifestKey);
  if (!object) throw new Error("active public manifest is missing");
  if ((await sha256Hex(object.bytes)) !== pointer.active.manifestSha256) {
    throw new Error("active public manifest hash mismatch");
  }
  const manifest = manifestSchema.parse(parseJson(object.bytes));
  if (
    manifest.releaseId !== pointer.active.releaseId ||
    manifest.sourceWatermark !== pointer.sourceWatermark
  ) {
    throw new Error("active public manifest does not match pointer");
  }
  return manifest;
}

export async function uploadChangedReleaseArtifacts(
  store: PublisherObjectStore,
  release: BuiltPublicRelease,
  metrics: PublicPublisherObjectMetrics,
): Promise<void> {
  for (const artifact of release.artifacts) {
    if (artifact.unchanged) {
      metrics.reused += 1;
      metrics.reusedBytes += artifact.bytes.byteLength;
      continue;
    }
    const put = await store.putImmutable({
      key: artifact.descriptor.key,
      bytes: artifact.bytes,
      mediaType: artifact.descriptor.mediaType,
      cacheControl: IMMUTABLE_PUBLIC_CACHE_CONTROL,
    });
    const stored = await store.readObject(artifact.descriptor.key);
    if (!stored) throw new Error(`uploaded artifact is missing: ${artifact.logicalName}`);
    await verifyDescriptorBytes(artifact.descriptor, stored.bytes);
    if (!equalBytes(stored.bytes, artifact.bytes)) {
      throw new Error(`uploaded artifact bytes changed: ${artifact.logicalName}`);
    }
    parsePublicEntityShardValue(
      artifact.logicalName,
      parseJson(stored.bytes),
    );
    if (put.status === "uploaded") {
      metrics.uploaded += 1;
      metrics.uploadedBytes += artifact.bytes.byteLength;
    } else {
      metrics.reused += 1;
      metrics.reusedBytes += artifact.bytes.byteLength;
    }
  }
}

export async function uploadAndVerifyReleaseManifest(
  store: PublisherObjectStore,
  release: BuiltPublicRelease,
): Promise<void> {
  const key = releaseManifestKey(release.releaseId);
  await store.putImmutable({
    key,
    bytes: release.manifestBytes,
    mediaType: "application/json",
    cacheControl: IMMUTABLE_PUBLIC_CACHE_CONTROL,
  });
  const stored = await store.readObject(key);
  if (!stored) throw new Error("uploaded public manifest is missing");
  if ((await sha256Hex(stored.bytes)) !== release.manifestSha256) {
    throw new Error("uploaded public manifest hash mismatch");
  }
  const parsed = manifestSchema.parse(parseJson(stored.bytes));
  if (parsed.releaseId !== release.releaseId) {
    throw new Error("uploaded public manifest release mismatch");
  }
}

export async function commitSnapshotPointer(
  store: PublisherObjectStore,
  expectedEtag: string | null,
  pointer: SnapshotPointer,
  bytes: Uint8Array,
): Promise<boolean> {
  try {
    const result = await store.compareAndSwapPointer({
      key: CURRENT_POINTER_KEY,
      expectedEtag,
      bytes,
      mediaType: "application/json",
      cacheControl: POINTER_PUBLIC_CACHE_CONTROL,
    });
    if (result.status === "conflict") return false;
  } catch {
    return pointerMatches(await safelyReadPointer(store), pointer);
  }
  return pointerMatches(await safelyReadPointer(store), pointer);
}

async function safelyReadPointer(
  store: PublisherObjectStore,
): Promise<SnapshotPointer | null> {
  try {
    return (await requireCurrentPointer(store)).pointer;
  } catch {
    return null;
  }
}

function pointerMatches(
  actual: SnapshotPointer | null,
  expected: SnapshotPointer,
): boolean {
  return (
    actual?.active.releaseId === expected.active.releaseId &&
    actual.active.manifestSha256 === expected.active.manifestSha256 &&
    actual.sourceWatermark === expected.sourceWatermark
  );
}

function validateBatch(batch: PublisherSourceBatch, expectedFrom: number): void {
  if (
    batch.fromWatermark !== expectedFrom ||
    batch.toWatermark < batch.fromWatermark
  ) {
    throw new Error("publisher source returned an invalid watermark range");
  }
}

function receipt(
  context: ReceiptContext,
  status: "succeeded" | "failed" | "noop",
  failureStage: PublicPublisherReceipt["failureStage"],
  releaseId: string | null,
): PublicPublisherReceipt {
  const finishedAtMs = context.now();
  const batch = context.batch;
  return runReceiptSchema.parse({
    schemaVersion: 1,
    runId: context.runId,
    mode: "incremental",
    status,
    startedAt: iso(context.startedAtMs),
    finishedAt: iso(finishedAtMs),
    durationMs: Math.max(0, finishedAtMs - context.startedAtMs),
    sourceWatermark: {
      from: batch?.fromWatermark ?? context.fromWatermark,
      to: batch?.toWatermark ?? context.fromWatermark,
    },
    rows: {
      candidate: batch?.telemetry.candidateRows ?? 0,
      deduped: batch?.telemetry.dedupedEntities ?? 0,
      returned: batch?.telemetry.returnedRows ?? 0,
      scannedRows: batch?.telemetry.scannedRows ?? 0,
      scanMeasurementKind: "plan_upper_bound",
      queryCount: batch?.telemetry.queryCount ?? 0,
      verifiedIndexes: batch?.telemetry.verifiedPlans ?? [],
    },
    changed: changeCounts(batch?.changes ?? []),
    objects: context.objects,
    releaseId,
    failureStage,
  });
}

function changeCounts(changes: readonly PublicEntityChange[]) {
  const counts = {
    items: 0,
    events: 0,
    sources: 0,
    newsletters: 0,
    policies: 0,
    tombstones: 0,
  };
  for (const change of changes) {
    if (change.entityType === "item") counts.items += 1;
    else if (change.entityType === "event") counts.events += 1;
    else if (change.entityType === "source") counts.sources += 1;
    else if (change.entityType === "newsletter") counts.newsletters += 1;
    else counts.policies += 1;
    if (change.value === null) counts.tombstones += 1;
  }
  return counts;
}

export function emptyPublicPublisherObjectMetrics(): PublicPublisherObjectMetrics {
  return { uploaded: 0, reused: 0, uploadedBytes: 0, reusedBytes: 0 };
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function iso(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("invalid publisher clock");
  return date.toISOString();
}
