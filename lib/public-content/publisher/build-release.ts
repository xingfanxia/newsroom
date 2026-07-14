import { z } from "zod";
import { canonicalJsonBytes, canonicalSha256, sha256Hex } from "@/lib/public-content/canonical";
import {
  artifactDescriptorSchema,
  manifestSchema,
  publicEventSchema,
  publicItemSchema,
  publicNewsletterSchema,
  publicPolicySchema,
  publicSourceSchema,
} from "@/lib/public-content/contracts";
import { objectKey } from "@/lib/public-content/paths";
import type {
  PublicEntityChange,
  PublicEntityType,
} from "./types";

const idBucketSchema = z.strictObject({
  kind: z.literal("id_bucket"),
  bucket: z.string().regex(/^[a-f0-9]{2}$/),
});
const singletonSchema = z.strictObject({ kind: z.literal("singleton") });

const itemShardSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entityType: z.literal("item"),
  shard: idBucketSchema,
  entities: z.array(publicItemSchema),
});
const eventShardSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entityType: z.literal("event"),
  shard: idBucketSchema,
  entities: z.array(publicEventSchema),
});
const sourceShardSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entityType: z.literal("source"),
  shard: singletonSchema,
  entities: z.array(publicSourceSchema),
});
const newsletterShardSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entityType: z.literal("newsletter"),
  shard: idBucketSchema,
  entities: z.array(publicNewsletterSchema),
});
const policyShardSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entityType: z.literal("policy"),
  shard: singletonSchema,
  entities: z.array(publicPolicySchema),
});

const shardSchemas = {
  item: itemShardSchema,
  event: eventShardSchema,
  source: sourceShardSchema,
  newsletter: newsletterShardSchema,
  policy: policyShardSchema,
} as const;

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
    const expectedShard = shardFor(entityType, changes[0]!.entityKey);
    const previousDescriptor = previous?.artifacts[logicalName];
    let entities: unknown[] = [];
    if (previousDescriptor) {
      assertDescriptorShard(previousDescriptor, expectedShard);
      const bytes = await input.loadArtifact(logicalName, previousDescriptor);
      loadedArtifactCount += 1;
      await verifyDescriptorBytes(previousDescriptor, bytes);
      entities = parseShard(entityType, expectedShard, bytes).entities;
    }

    const patched = patchEntities(entityType, entities, changes);
    const shard = shardSchemas[entityType].parse({
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

export function publicEntityShardLogicalName(
  entityType: PublicEntityType,
  entityKey: string,
): string {
  if (entityType === "source") return "state/sources";
  if (entityType === "policy") return "state/policies";
  const bucket = numericBucket(entityKey, entityType);
  const plural =
    entityType === "item"
      ? "items"
      : entityType === "event"
        ? "events"
        : "newsletters";
  return `state/${plural}/${bucket}`;
}

export function publicEntityTypeFromShardLogicalName(
  logicalName: string,
): PublicEntityType {
  if (logicalName === "state/sources") return "source";
  if (logicalName === "state/policies") return "policy";
  if (/^state\/items\/[a-f0-9]{2}$/.test(logicalName)) return "item";
  if (/^state\/events\/[a-f0-9]{2}$/.test(logicalName)) return "event";
  if (/^state\/newsletters\/[a-f0-9]{2}$/.test(logicalName)) {
    return "newsletter";
  }
  throw new Error(`unknown public entity shard: ${logicalName}`);
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

export function parsePublicEntityShard(
  entityType: PublicEntityType,
  bytes: Uint8Array,
): z.infer<(typeof shardSchemas)[PublicEntityType]> {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  return shardSchemas[entityType].parse(value) as z.infer<
    (typeof shardSchemas)[PublicEntityType]
  >;
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
    entities.set(entityKey(entityType, value), value);
  }
  for (const change of changes) {
    if (change.entityType !== entityType) {
      throw new Error("mixed entity types in public shard patch");
    }
    if (change.value === null) entities.delete(change.entityKey);
    else {
      const parsed = shardSchemas[entityType].shape.entities.element.parse(
        change.value,
      );
      if (entityKey(entityType, parsed) !== change.entityKey) {
        throw new Error(`${entityType} key/value mismatch`);
      }
      entities.set(change.entityKey, parsed);
    }
  }
  return [...entities.entries()]
    .sort(([left], [right]) => compareEntityKeys(entityType, left, right))
    .map(([, value]) => value);
}

function parseShard(
  entityType: PublicEntityType,
  expectedShard: ReturnType<typeof shardFor>,
  bytes: Uint8Array,
) {
  const parsed = parsePublicEntityShard(entityType, bytes);
  if (JSON.stringify(parsed.shard) !== JSON.stringify(expectedShard)) {
    throw new Error(`artifact shard mismatch for ${entityType}`);
  }
  const seen = new Set<string>();
  for (const entity of parsed.entities) {
    const key = entityKey(entityType, entity);
    if (seen.has(key)) throw new Error(`duplicate ${entityType} in shard`);
    seen.add(key);
    if (JSON.stringify(shardFor(entityType, key)) !== JSON.stringify(expectedShard)) {
      throw new Error(`${entityType} is stored in the wrong shard`);
    }
  }
  return parsed;
}

function entityKey(entityType: PublicEntityType, value: unknown): string {
  const record = value as Record<string, unknown>;
  if (entityType === "source") return String(record.id);
  if (entityType === "policy") return String(record.skillName);
  return String(record.id);
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

function shardFor(entityType: PublicEntityType, entityKey: string) {
  return entityType === "source" || entityType === "policy"
    ? ({ kind: "singleton" } as const)
    : ({
        kind: "id_bucket",
        bucket: numericBucket(entityKey, entityType),
      } as const);
}

function numericBucket(value: string, label: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`invalid ${label} key`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`invalid ${label} key`);
  return (parsed % 256).toString(16).padStart(2, "0");
}

function assertDescriptorShard(
  descriptor: ArtifactDescriptor,
  expected: ReturnType<typeof shardFor>,
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
