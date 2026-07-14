import { canonicalJsonBytes } from "@/lib/public-content/canonical";
import {
  canonicalStateSchema,
  runReceiptSchema,
  snapshotPointerSchema,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import { CURRENT_POINTER_KEY, releaseManifestKey } from "@/lib/public-content/paths";
import { buildPublicRelease } from "./build-release";
import type { PublisherObjectStore } from "./object-store";
import {
  commitSnapshotPointer,
  emptyPublicPublisherObjectMetrics,
  uploadAndVerifyReleaseManifest,
  uploadChangedReleaseArtifacts,
  type PublicPublisherObjectMetrics,
  type PublicPublisherReceipt,
} from "./publish";
import type { PublicEntityChange } from "./types";

const MAX_BOOTSTRAP_OBJECT_WRITES = 500;

export type BootstrapSpendReservation = {
  runId: string;
  bootstrapSnapshots: 1;
  objectWrites: number;
};

export interface BootstrapSpendLedger {
  reserveBootstrap(reservation: BootstrapSpendReservation): Promise<boolean>;
}

export type BootstrapPublicSnapshotInput = {
  state: unknown;
  sourceWatermark: number;
  store: PublisherObjectStore;
  spendLedger: BootstrapSpendLedger;
  runId: string;
  now?: () => number;
};

export async function bootstrapPublicSnapshot(
  input: BootstrapPublicSnapshotInput,
): Promise<PublicPublisherReceipt> {
  assertWatermark(input.sourceWatermark);
  const now = input.now ?? Date.now;
  const startedAtMs = now();
  const objects = emptyPublicPublisherObjectMetrics();
  let state: CanonicalPublicState | null = null;

  try {
    if (await input.store.readObject(CURRENT_POINTER_KEY)) {
      return bootstrapReceipt(
        input,
        startedAtMs,
        now,
        state,
        objects,
        "failed",
        "build_state",
        null,
      );
    }
    state = canonicalStateSchema.parse(input.state);
  } catch {
    return bootstrapReceipt(
      input,
      startedAtMs,
      now,
      state,
      objects,
      "failed",
      "build_state",
      null,
    );
  }

  let release: Awaited<ReturnType<typeof buildPublicRelease>>;
  try {
    release = await buildPublicRelease({
      previousManifest: null,
      sourceWatermark: input.sourceWatermark,
      changes: stateChanges(state),
      loadArtifact: async () => {
        throw new Error("bootstrap cannot load prior release artifacts");
      },
    });
  } catch {
    return bootstrapReceipt(
      input,
      startedAtMs,
      now,
      state,
      objects,
      "failed",
      "derive",
      null,
    );
  }

  const objectWrites = release.artifacts.length + 3;
  if (
    objectWrites > MAX_BOOTSTRAP_OBJECT_WRITES ||
    !(await input.spendLedger.reserveBootstrap({
      runId: input.runId,
      bootstrapSnapshots: 1,
      objectWrites,
    }))
  ) {
    return bootstrapReceipt(
      input,
      startedAtMs,
      now,
      state,
      objects,
      "failed",
      "build_state",
      null,
    );
  }

  try {
    await uploadChangedReleaseArtifacts(input.store, release, objects);
  } catch {
    return bootstrapReceipt(
      input,
      startedAtMs,
      now,
      state,
      objects,
      "failed",
      "upload_objects",
      null,
    );
  }
  try {
    await uploadAndVerifyReleaseManifest(input.store, release);
  } catch {
    return bootstrapReceipt(
      input,
      startedAtMs,
      now,
      state,
      objects,
      "failed",
      "upload_manifest",
      null,
    );
  }

  const pointer = snapshotPointerSchema.parse({
    schemaVersion: 1,
    active: {
      releaseId: release.releaseId,
      manifestKey: releaseManifestKey(release.releaseId),
      manifestSha256: release.manifestSha256,
    },
    previous: null,
    publishedAt: iso(now()),
    sourceWatermark: input.sourceWatermark,
  });
  const committed = await commitSnapshotPointer(
    input.store,
    null,
    pointer,
    canonicalJsonBytes(pointer),
  );
  if (!committed) {
    return bootstrapReceipt(
      input,
      startedAtMs,
      now,
      state,
      objects,
      "failed",
      "advance_pointer",
      null,
    );
  }
  return bootstrapReceipt(
    input,
    startedAtMs,
    now,
    state,
    objects,
    "succeeded",
    null,
    release.releaseId,
  );
}

function stateChanges(state: CanonicalPublicState): PublicEntityChange[] {
  return [
    ...state.sources.map(
      (value): PublicEntityChange => ({
        entityType: "source",
        entityKey: value.id,
        value,
      }),
    ),
    ...state.items.map(
      (value): PublicEntityChange => ({
        entityType: "item",
        entityKey: String(value.id),
        value,
      }),
    ),
    ...state.events.map(
      (value): PublicEntityChange => ({
        entityType: "event",
        entityKey: String(value.id),
        value,
      }),
    ),
    ...state.newsletters.map(
      (value): PublicEntityChange => ({
        entityType: "newsletter",
        entityKey: String(value.id),
        value,
      }),
    ),
    ...state.policies.map(
      (value): PublicEntityChange => ({
        entityType: "policy",
        entityKey: value.skillName,
        value,
      }),
    ),
  ];
}

function bootstrapReceipt(
  input: BootstrapPublicSnapshotInput,
  startedAtMs: number,
  now: () => number,
  state: CanonicalPublicState | null,
  objects: PublicPublisherObjectMetrics,
  status: "succeeded" | "failed",
  failureStage: PublicPublisherReceipt["failureStage"],
  releaseId: string | null,
): PublicPublisherReceipt {
  const finishedAtMs = now();
  return runReceiptSchema.parse({
    schemaVersion: 1,
    runId: input.runId,
    mode: "bootstrap",
    status,
    startedAt: iso(startedAtMs),
    finishedAt: iso(finishedAtMs),
    durationMs: Math.max(0, finishedAtMs - startedAtMs),
    sourceWatermark: { from: 0, to: input.sourceWatermark },
    rows: {
      candidate: 0,
      deduped: 0,
      returned: 0,
      scannedRows: 0,
      scanMeasurementKind: "plan_upper_bound",
      queryCount: 0,
      verifiedIndexes: [],
    },
    changed: {
      items: state?.items.length ?? 0,
      events: state?.events.length ?? 0,
      sources: state?.sources.length ?? 0,
      newsletters: state?.newsletters.length ?? 0,
      policies: state?.policies.length ?? 0,
      tombstones: 0,
    },
    objects,
    releaseId,
    failureStage,
  });
}

function assertWatermark(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("bootstrap watermark must be a non-negative integer");
  }
}

function iso(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("invalid bootstrap clock");
  return date.toISOString();
}
