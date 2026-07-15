import { z } from "zod";
import {
  canonicalJsonBytes,
  canonicalSha256,
  sha256Hex,
} from "@/lib/public-content/canonical";
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

type BuiltReleaseArtifact = {
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
  const built: BuiltReleaseArtifact[] = [];
  let loadedArtifactCount = 0;
  const repartitionNumericShards =
    previous !== null && requiresNumericShardMigration(previous);
  if (repartitionNumericShards) {
    const migration = await buildRepartitionedNumericArtifacts(
      previous,
      input.changes,
      input.loadArtifact,
    );
    for (const logicalName of Object.keys(nextDescriptors)) {
      if (isNumericShardLogicalName(logicalName)) {
        delete nextDescriptors[logicalName];
      }
    }
    for (const artifact of migration.artifacts) {
      nextDescriptors[artifact.logicalName] = artifact.descriptor;
      built.push(artifact);
    }
    loadedArtifactCount += migration.loadedArtifactCount;
  }
  const incrementalChanges = repartitionNumericShards
    ? input.changes.filter(({ entityType }) => !isNumericEntityType(entityType))
    : input.changes;
  const grouped = groupChanges(incrementalChanges);

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
    const artifact = await buildShardArtifact(
      entityType,
      logicalName,
      expectedShard,
      patched,
      previousDescriptor,
    );
    nextDescriptors[logicalName] = artifact.descriptor;
    built.push(artifact);
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

type NumericEntityType = Extract<
  PublicEntityType,
  "item" | "event" | "newsletter"
>;

async function buildRepartitionedNumericArtifacts(
  previous: PublicReleaseManifest,
  changes: readonly PublicEntityChange[],
  loadArtifact: BuildPublicReleaseInput["loadArtifact"],
): Promise<{
  artifacts: BuiltReleaseArtifact[];
  loadedArtifactCount: number;
}> {
  const entities: Record<NumericEntityType, Map<string, unknown>> = {
    item: new Map(),
    event: new Map(),
    newsletter: new Map(),
  };
  let loadedArtifactCount = 0;
  for (const [logicalName, descriptor] of Object.entries(previous.artifacts)) {
    if (!isNumericShardLogicalName(logicalName)) continue;
    const bytes = await loadArtifact(logicalName, descriptor);
    loadedArtifactCount += 1;
    await verifyDescriptorBytes(descriptor, bytes);
    const shard = parsePublicEntityShardValue(
      logicalName,
      JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    );
    if (!isNumericEntityType(shard.entityType)) {
      throw new Error(`non-numeric entity in numeric shard: ${logicalName}`);
    }
    const destination = entities[shard.entityType];
    for (const value of shard.entities) {
      const key = publicEntityKey(shard.entityType, value);
      if (destination.has(key)) {
        throw new Error(`duplicate ${shard.entityType} across prior shards`);
      }
      destination.set(key, value);
    }
  }
  for (const change of changes) {
    if (!isNumericEntityType(change.entityType)) continue;
    const destination = entities[change.entityType];
    if (change.value === null) destination.delete(change.entityKey);
    else {
      const parsed = parsePublicEntityValue(change.entityType, change.value);
      if (publicEntityKey(change.entityType, parsed) !== change.entityKey) {
        throw new Error(`${change.entityType} key/value mismatch`);
      }
      destination.set(change.entityKey, parsed);
    }
  }

  const grouped = new Map<
    string,
    { entityType: NumericEntityType; values: unknown[] }
  >();
  for (const entityType of ["item", "event", "newsletter"] as const) {
    for (const [entityKey, value] of entities[entityType]) {
      const logicalName = publicEntityShardLogicalName(entityType, entityKey);
      const group = grouped.get(logicalName) ?? { entityType, values: [] };
      group.values.push(value);
      grouped.set(logicalName, group);
    }
  }

  const artifacts: BuiltReleaseArtifact[] = [];
  for (const [logicalName, group] of [...grouped.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    group.values.sort((left, right) =>
      compareEntityKeys(
        group.entityType,
        publicEntityKey(group.entityType, left),
        publicEntityKey(group.entityType, right),
      ),
    );
    const firstKey = publicEntityKey(group.entityType, group.values[0]);
    const expectedShard = publicEntityShardMetadata(group.entityType, firstKey);
    artifacts.push(
      await buildShardArtifact(
        group.entityType,
        logicalName,
        expectedShard,
        group.values,
        previous.artifacts[logicalName],
      ),
    );
  }
  return { artifacts, loadedArtifactCount };
}

async function buildShardArtifact(
  entityType: PublicEntityType,
  logicalName: string,
  shardMetadata: ReturnType<typeof publicEntityShardMetadata>,
  entities: readonly unknown[],
  previousDescriptor: ArtifactDescriptor | undefined,
): Promise<BuiltReleaseArtifact> {
  const shard = publicEntityShardSchemas[entityType].parse({
    schemaVersion: 1,
    entityType,
    shard: shardMetadata,
    entities,
  });
  const bytes = canonicalJsonBytes(shard);
  const sha256 = await sha256Hex(bytes);
  const descriptor = artifactDescriptorSchema.parse({
    key: objectKey(sha256, "json"),
    sha256,
    byteLength: bytes.byteLength,
    mediaType: "application/json",
    encoding: "utf-8",
    shard: shardMetadata,
  });
  return {
    logicalName,
    descriptor,
    bytes,
    unchanged: previousDescriptor?.sha256 === sha256,
  };
}

export function requiresNumericShardMigration(
  manifest: PublicReleaseManifest,
): boolean {
  return Object.keys(manifest.artifacts).some((logicalName) => {
    if (!isNumericShardLogicalName(logicalName)) return false;
    return Number.parseInt(logicalName.slice(-2), 16) >= 16;
  });
}

function isNumericShardLogicalName(logicalName: string): boolean {
  return /^state\/(?:items|events|newsletters)\/[a-f0-9]{2}$/.test(logicalName);
}

function isNumericEntityType(
  entityType: PublicEntityType,
): entityType is NumericEntityType {
  return (
    entityType === "item" ||
    entityType === "event" ||
    entityType === "newsletter"
  );
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
