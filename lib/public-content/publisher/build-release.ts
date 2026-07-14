import { z } from "zod";
import { canonicalJsonBytes, canonicalSha256, sha256Hex } from "@/lib/public-content/canonical";
import {
  artifactDescriptorSchema,
  manifestSchema,
  parsePublicEntityShardValue,
  parsePublicEntityValue,
  publicEntityKey,
  publicEntityShardLogicalName,
  publicEntityShardMetadata,
  publicEntityShardSchemas,
  type PublicEntityType,
} from "@/lib/public-content/contracts";
import { objectKey } from "@/lib/public-content/paths";
import type { PublicEntityChange } from "./types";

type ArtifactDescriptor = z.infer<typeof artifactDescriptorSchema>;
export type PublicReleaseManifest = z.infer<typeof manifestSchema>;

export type BuiltReleaseArtifact = {
  logicalName: string;
  descriptor: ArtifactDescriptor;
  bytes: Uint8Array;
  unchanged: boolean;
};

export type BuiltPublicRelease = {
  releaseId: string;
  manifest: PublicReleaseManifest;
  manifestBytes: Uint8Array;
  manifestSha256: string;
  artifacts: BuiltReleaseArtifact[];
  loadedArtifactCount: number;
};

export type BuildPublicReleaseInput = {
  previousManifest: unknown | null;
  sourceWatermark: number;
  changes: readonly PublicEntityChange[];
  loadArtifact: (
    logicalName: string,
    descriptor: ArtifactDescriptor,
  ) => Promise<Uint8Array>;
};

export async function buildPublicRelease(
  input: BuildPublicReleaseInput,
): Promise<BuiltPublicRelease> {
  assertWatermark(input.sourceWatermark);
  const previous =
    input.previousManifest === null
      ? null
      : manifestSchema.parse(input.previousManifest);
  if (previous && previous.sourceWatermark > input.sourceWatermark) {
    throw new Error("release source watermark cannot move backwards");
  }
  const nextDescriptors: Record<string, ArtifactDescriptor> = {
    ...(previous?.artifacts ?? {}),
  };
  const grouped = groupChanges(input.changes);
  const built: BuiltReleaseArtifact[] = [];
  let loadedArtifactCount = 0;

  for (const [logicalName, changes] of grouped) {
    const entityType = changes[0]!.entityType;
    const expectedShard = publicEntityShardMetadata(
      entityType,
      changes[0]!.entityKey,
    );
    const previousDescriptor = previous?.artifacts[logicalName];
    let entities: unknown[] = [];
    if (previousDescriptor) {
      assertDescriptorShard(previousDescriptor, expectedShard);
      const bytes = await input.loadArtifact(logicalName, previousDescriptor);
      loadedArtifactCount += 1;
      await verifyDescriptorBytes(previousDescriptor, bytes);
      entities = parsePublicEntityShardValue(
        logicalName,
        JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      ).entities;
    }

    const patched = patchEntities(entityType, entities, changes);
    const shard = publicEntityShardSchemas[entityType].parse({
      schemaVersion: 1,
      entityType,
      shard: expectedShard,
      entities: patched,
    });
    const bytes = canonicalJsonBytes(shard);
    const sha256 = await sha256Hex(bytes);
    const descriptor = artifactDescriptorSchema.parse({
      key: objectKey(sha256, "json"),
      sha256,
      byteLength: bytes.byteLength,
      mediaType: "application/json",
      encoding: "utf-8",
      shard: expectedShard,
    });
    nextDescriptors[logicalName] = descriptor;
    built.push({
      logicalName,
      descriptor,
      bytes,
      unchanged: previousDescriptor?.sha256 === sha256,
    });
  }

  const identity = await canonicalSha256({
    schemaVersion: 1,
    sourceWatermark: input.sourceWatermark,
    artifacts: nextDescriptors,
  });
  const releaseId = `r${input.sourceWatermark}-${identity.slice(0, 20)}`;
  const manifest = manifestSchema.parse({
    schemaVersion: 1,
    releaseId,
    sourceWatermark: input.sourceWatermark,
    artifacts: nextDescriptors,
  });
  const manifestBytes = canonicalJsonBytes(manifest);
  return {
    releaseId,
    manifest,
    manifestBytes,
    manifestSha256: await sha256Hex(manifestBytes),
    artifacts: built,
    loadedArtifactCount,
  };
}

export async function verifyDescriptorBytes(
  descriptorValue: unknown,
  bytes: Uint8Array,
): Promise<void> {
  const descriptor = artifactDescriptorSchema.parse(descriptorValue);
  if (bytes.byteLength !== descriptor.byteLength) {
    throw new Error(`artifact byte length mismatch: ${descriptor.key}`);
  }
  if ((await sha256Hex(bytes)) !== descriptor.sha256) {
    throw new Error(`artifact hash mismatch: ${descriptor.key}`);
  }
}

function groupChanges(
  changes: readonly PublicEntityChange[],
): Map<string, PublicEntityChange[]> {
  const groups = new Map<string, PublicEntityChange[]>();
  for (const change of changes) {
    const logicalName = publicEntityShardLogicalName(
      change.entityType,
      change.entityKey,
    );
    const group = groups.get(logicalName) ?? [];
    if (group[0] && group[0].entityType !== change.entityType) {
      throw new Error(`mixed entity types in shard ${logicalName}`);
    }
    group.push(change);
    groups.set(logicalName, group);
  }
  return groups;
}

function patchEntities(
  entityType: PublicEntityType,
  previous: readonly unknown[],
  changes: readonly PublicEntityChange[],
): unknown[] {
  const entities = new Map<string, unknown>();
  for (const value of previous) {
    entities.set(publicEntityKey(entityType, value), value);
  }
  for (const change of changes) {
    if (change.entityType !== entityType) {
      throw new Error("mixed entity types in public shard patch");
    }
    if (change.value === null) entities.delete(change.entityKey);
    else {
      const parsed = parsePublicEntityValue(entityType, change.value);
      if (publicEntityKey(entityType, parsed) !== change.entityKey) {
        throw new Error(`${entityType} key/value mismatch`);
      }
      entities.set(change.entityKey, parsed);
    }
  }
  return [...entities.entries()]
    .sort(([left], [right]) => compareEntityKeys(entityType, left, right))
    .map(([, value]) => value);
}

function compareEntityKeys(
  entityType: PublicEntityType,
  left: string,
  right: string,
): number {
  if (entityType === "source" || entityType === "policy") {
    return left.localeCompare(right);
  }
  return Number(left) - Number(right);
}

function assertDescriptorShard(
  descriptor: ArtifactDescriptor,
  expected: ReturnType<typeof publicEntityShardMetadata>,
): void {
  if (JSON.stringify(descriptor.shard) !== JSON.stringify(expected)) {
    throw new Error(`manifest descriptor shard mismatch: ${descriptor.key}`);
  }
}

function assertWatermark(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("source watermark must be a non-negative safe integer");
  }
}
