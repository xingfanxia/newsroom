import { canonicalJsonBytes, sha256Hex } from "@/lib/public-content/canonical";
import {
  manifestSchema,
  snapshotPointerSchema,
} from "@/lib/public-content/contracts";
import { CURRENT_POINTER_KEY } from "@/lib/public-content/paths";
import {
  POINTER_PUBLIC_CACHE_CONTROL,
  type PublisherObjectStore,
} from "./object-store";

export type PublicPointerRollbackReceipt = {
  fromReleaseId: string;
  rollbackReleaseId: string;
  pointerEtagBefore: string;
  pointerEtagAfter: string;
  conditionalPointerReplace: true;
  sourceWatermark: number;
  capturedAt: string;
};

export async function swapPublicPointerToPrevious(
  store: PublisherObjectStore,
  now: () => number = Date.now,
): Promise<PublicPointerRollbackReceipt> {
  const currentObject = await store.readObject(CURRENT_POINTER_KEY);
  if (!currentObject) throw new Error("public snapshot pointer is missing");
  const current = snapshotPointerSchema.parse(parseJson(currentObject.bytes));
  if (!current.previous)
    throw new Error("public snapshot has no previous release");

  const rollbackManifestObject = await store.readObject(
    current.previous.manifestKey,
  );
  if (!rollbackManifestObject) throw new Error("rollback manifest is missing");
  if (
    (await sha256Hex(rollbackManifestObject.bytes)) !==
    current.previous.manifestSha256
  ) {
    throw new Error("rollback manifest hash mismatch");
  }
  const rollbackManifest = manifestSchema.parse(
    parseJson(rollbackManifestObject.bytes),
  );
  if (rollbackManifest.releaseId !== current.previous.releaseId) {
    throw new Error("rollback manifest release mismatch");
  }

  const capturedAt = new Date(now()).toISOString();
  const rollback = snapshotPointerSchema.parse({
    schemaVersion: 1,
    active: current.previous,
    previous: current.active,
    publishedAt: capturedAt,
    sourceWatermark: rollbackManifest.sourceWatermark,
  });
  const replaced = await store.compareAndSwapPointer({
    key: CURRENT_POINTER_KEY,
    expectedEtag: currentObject.etag,
    bytes: canonicalJsonBytes(rollback),
    mediaType: "application/json",
    cacheControl: POINTER_PUBLIC_CACHE_CONTROL,
  });
  if (replaced.status !== "committed" || !replaced.etag) {
    throw new Error("conditional public pointer replacement conflicted");
  }
  const readback = await store.readObject(CURRENT_POINTER_KEY);
  if (!readback) throw new Error("rolled-back public pointer is missing");
  const parsedReadback = snapshotPointerSchema.parse(parseJson(readback.bytes));
  if (
    parsedReadback.active.releaseId !== rollback.active.releaseId ||
    parsedReadback.sourceWatermark !== rollback.sourceWatermark
  ) {
    throw new Error("rolled-back public pointer readback mismatch");
  }
  return {
    fromReleaseId: current.active.releaseId,
    rollbackReleaseId: rollback.active.releaseId,
    pointerEtagBefore: currentObject.etag,
    pointerEtagAfter: readback.etag,
    conditionalPointerReplace: true,
    sourceWatermark: rollback.sourceWatermark,
    capturedAt,
  };
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
