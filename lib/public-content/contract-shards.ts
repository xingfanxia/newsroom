import { z } from "zod";
import {
  publicEventSchema,
  publicItemSchema,
  publicNewsletterSchema,
  publicPolicySchema,
  publicSourceSchema,
} from "./contract-entities";

export const PUBLIC_ENTITY_TYPES = [
  "item",
  "event",
  "source",
  "newsletter",
  "policy",
] as const;
export type PublicEntityType = (typeof PUBLIC_ENTITY_TYPES)[number];

export const PUBLIC_NUMERIC_SHARD_COUNT = 128;

const idBucketShardSchema = z.strictObject({
  kind: z.literal("id_bucket"),
  bucket: z.string().regex(/^[a-f0-9]{2}$/),
});
const singletonShardSchema = z.strictObject({
  kind: z.literal("singleton"),
});

export const publicEntityShardSchemas = {
  item: z.strictObject({
    schemaVersion: z.literal(1),
    entityType: z.literal("item"),
    shard: idBucketShardSchema,
    entities: z.array(publicItemSchema),
  }),
  event: z.strictObject({
    schemaVersion: z.literal(1),
    entityType: z.literal("event"),
    shard: idBucketShardSchema,
    entities: z.array(publicEventSchema),
  }),
  source: z.strictObject({
    schemaVersion: z.literal(1),
    entityType: z.literal("source"),
    shard: singletonShardSchema,
    entities: z.array(publicSourceSchema),
  }),
  newsletter: z.strictObject({
    schemaVersion: z.literal(1),
    entityType: z.literal("newsletter"),
    shard: idBucketShardSchema,
    entities: z.array(publicNewsletterSchema),
  }),
  policy: z.strictObject({
    schemaVersion: z.literal(1),
    entityType: z.literal("policy"),
    shard: singletonShardSchema,
    entities: z.array(publicPolicySchema),
  }),
} as const;

type PublicEntityShard = z.infer<
  (typeof publicEntityShardSchemas)[PublicEntityType]
>;
type PublicEntityShardMetadata =
  | z.infer<typeof idBucketShardSchema>
  | z.infer<typeof singletonShardSchema>;

export function parsePublicEntityShardValue(
  logicalName: string,
  value: unknown,
): PublicEntityShard {
  const entityType = publicEntityTypeFromShardLogicalName(logicalName);
  const parsed = publicEntityShardSchemas[entityType].parse(
    value,
  ) as PublicEntityShard;
  const expectedShard = publicEntityShardMetadataFromLogicalName(logicalName);
  if (JSON.stringify(parsed.shard) !== JSON.stringify(expectedShard)) {
    throw new Error(`public entity shard metadata mismatch: ${logicalName}`);
  }
  const seen = new Set<string>();
  for (const entity of parsed.entities) {
    const key = publicEntityKey(entityType, entity);
    if (seen.has(key)) throw new Error(`duplicate ${entityType} in shard`);
    seen.add(key);
    if (publicEntityShardLogicalName(entityType, key) !== logicalName) {
      throw new Error(`${entityType} is stored in the wrong shard`);
    }
  }
  return parsed;
}

export function parsePublicEntityValue(
  entityType: PublicEntityType,
  value: unknown,
): unknown {
  return publicEntityShardSchemas[entityType].shape.entities.element.parse(
    value,
  );
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

function publicEntityTypeFromShardLogicalName(
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

export function publicEntityShardMetadata(
  entityType: PublicEntityType,
  entityKey: string,
): PublicEntityShardMetadata {
  return entityType === "source" || entityType === "policy"
    ? { kind: "singleton" }
    : {
        kind: "id_bucket",
        bucket: numericBucket(entityKey, entityType),
      };
}

export function publicEntityKey(
  entityType: PublicEntityType,
  value: unknown,
): string {
  const record = value as Record<string, unknown>;
  if (entityType === "source") return String(record.id);
  if (entityType === "policy") return String(record.skillName);
  return String(record.id);
}

function publicEntityShardMetadataFromLogicalName(
  logicalName: string,
): PublicEntityShardMetadata {
  const entityType = publicEntityTypeFromShardLogicalName(logicalName);
  if (entityType === "source" || entityType === "policy") {
    return { kind: "singleton" };
  }
  return { kind: "id_bucket", bucket: logicalName.slice(-2) };
}

function numericBucket(value: string, label: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`invalid ${label} key`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`invalid ${label} key`);
  return (parsed % PUBLIC_NUMERIC_SHARD_COUNT)
    .toString(16)
    .padStart(2, "0");
}
