import { manifestSchema, snapshotPointerSchema } from "@/lib/public-content/contracts";
import { sha256Hex } from "@/lib/public-content/canonical";
import { CURRENT_POINTER_KEY } from "@/lib/public-content/paths";
import {
  parsePublicEntityShard,
  publicEntityTypeFromShardLogicalName,
  verifyDescriptorBytes,
} from "./build-release";
import type { PublisherObjectStore } from "./object-store";

const MAX_RECONCILE_ARTIFACTS = 500;

export type PublicSnapshotReconcileReceipt = {
  status: "succeeded" | "failed";
  releaseId: string | null;
  totalArtifacts: number;
  checkedArtifacts: number;
  maxArtifacts: number;
  truncated: boolean;
  objectReads: number;
  failures: Array<{
    logicalName: string;
    reason: "pointer_invalid" | "manifest_invalid" | "missing" | "invalid";
  }>;
  pointerMutated: false;
  operatorPauseRequired: boolean;
};

export async function reconcilePublicSnapshot(
  store: PublisherObjectStore,
  options: { maxArtifacts?: number } = {},
): Promise<PublicSnapshotReconcileReceipt> {
  const maxArtifacts = options.maxArtifacts ?? 100;
  if (
    !Number.isSafeInteger(maxArtifacts) ||
    maxArtifacts < 1 ||
    maxArtifacts > MAX_RECONCILE_ARTIFACTS
  ) {
    throw new TypeError(
      `maxArtifacts must be between 1 and ${MAX_RECONCILE_ARTIFACTS}`,
    );
  }
  let objectReads = 1;
  let releaseId: string | null = null;
  try {
    const pointerObject = await store.readObject(CURRENT_POINTER_KEY);
    if (!pointerObject) throw new Error("missing pointer");
    const pointer = snapshotPointerSchema.parse(parseJson(pointerObject.bytes));
    releaseId = pointer.active.releaseId;

    objectReads += 1;
    const manifestObject = await store.readObject(pointer.active.manifestKey);
    if (
      !manifestObject ||
      (await sha256Hex(manifestObject.bytes)) !== pointer.active.manifestSha256
    ) {
      return failedReceipt(
        releaseId,
        maxArtifacts,
        objectReads,
        "manifest_invalid",
      );
    }
    const manifest = manifestSchema.parse(parseJson(manifestObject.bytes));
    if (
      manifest.releaseId !== pointer.active.releaseId ||
      manifest.sourceWatermark !== pointer.sourceWatermark
    ) {
      return failedReceipt(
        releaseId,
        maxArtifacts,
        objectReads,
        "manifest_invalid",
      );
    }

    const entries = Object.entries(manifest.artifacts).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const selected = entries.slice(0, maxArtifacts);
    const failures: PublicSnapshotReconcileReceipt["failures"] = [];
    for (const [logicalName, descriptor] of selected) {
      objectReads += 1;
      const object = await store.readObject(descriptor.key);
      if (!object) {
        failures.push({ logicalName, reason: "missing" });
        continue;
      }
      try {
        await verifyDescriptorBytes(descriptor, object.bytes);
        if (logicalName.startsWith("state/")) {
          parsePublicEntityShard(
            publicEntityTypeFromShardLogicalName(logicalName),
            object.bytes,
          );
        }
      } catch {
        failures.push({ logicalName, reason: "invalid" });
      }
    }
    return {
      status: failures.length === 0 ? "succeeded" : "failed",
      releaseId,
      totalArtifacts: entries.length,
      checkedArtifacts: selected.length,
      maxArtifacts,
      truncated: entries.length > selected.length,
      objectReads,
      failures,
      pointerMutated: false,
      operatorPauseRequired: failures.length > 0,
    };
  } catch {
    return failedReceipt(
      releaseId,
      maxArtifacts,
      objectReads,
      releaseId === null ? "pointer_invalid" : "manifest_invalid",
    );
  }
}

function failedReceipt(
  releaseId: string | null,
  maxArtifacts: number,
  objectReads: number,
  reason: "pointer_invalid" | "manifest_invalid",
): PublicSnapshotReconcileReceipt {
  return {
    status: "failed",
    releaseId,
    totalArtifacts: 0,
    checkedArtifacts: 0,
    maxArtifacts,
    truncated: false,
    objectReads,
    failures: [{ logicalName: "release", reason }],
    pointerMutated: false,
    operatorPauseRequired: true,
  };
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
