import { z } from "zod";
import {
  canonicalJsonBytes,
  canonicalSha256,
  sha256Hex,
} from "@/lib/public-content/canonical";
import {
  artifactDescriptorSchema,
  canonicalStateSchema,
  manifestSchema,
  parsePublicEntityShardValue,
  parsePublicEntityValue,
  parsePublicItemBodyShardValue,
  PUBLIC_NUMERIC_SHARD_COUNT,
  publicEntityKey,
  publicEntityShardLogicalName,
  publicEntityShardMetadata,
  publicEntityShardSchemas,
  publicItemBodyShardLogicalName,
  publicItemBodyShardSchema,
  publicItemSchema,
  type PublicEntityType,
} from "@/lib/public-content/contracts";
import { buildPublicFeedArtifactValues } from "@/lib/public-content/feed-artifacts";
import { objectKey } from "@/lib/public-content/paths";
import { buildMaterializedPageModels } from "./materialize-pages";
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
  generatedAtMs?: number;
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
  const splitItemBodies =
    previous !== null && requiresBodySplitMigration(previous);
  const migratedEntityTypes = new Set<NumericEntityType>(
    repartitionNumericShards
      ? ["item", "event", "newsletter"]
      : splitItemBodies
        ? ["item"]
        : [],
  );
  if (previous && migratedEntityTypes.size > 0) {
    const migration = await buildMigratedNumericArtifacts(
      previous,
      input.changes,
      input.loadArtifact,
      migratedEntityTypes,
      splitItemBodies,
    );
    for (const logicalName of Object.keys(nextDescriptors)) {
      if (
        isMigratedNumericShardLogicalName(logicalName, migratedEntityTypes) ||
        logicalName.startsWith("bodies/items/")
      ) {
        delete nextDescriptors[logicalName];
      }
    }
    for (const artifact of migration.artifacts) {
      nextDescriptors[artifact.logicalName] = artifact.descriptor;
      built.push(artifact);
    }
    loadedArtifactCount += migration.loadedArtifactCount;
  }
  const incrementalChanges = migratedEntityTypes.size > 0
    ? input.changes.filter(
        ({ entityType }) => !migratedEntityTypes.has(entityType as NumericEntityType),
      )
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
    if (entityType === "item") {
      const bodyLogicalName = publicItemBodyShardLogicalName(
        changes[0]!.entityKey,
      );
      const previousBodyDescriptor = previous?.artifacts[bodyLogicalName];
      let bodies: ItemBody[] = [];
      if (previousBodyDescriptor) {
        assertDescriptorShard(previousBodyDescriptor, expectedShard);
        const bytes = await input.loadArtifact(
          bodyLogicalName,
          previousBodyDescriptor,
        );
        loadedArtifactCount += 1;
        await verifyDescriptorBytes(previousBodyDescriptor, bytes);
        bodies = parsePublicItemBodyShardValue(
          bodyLogicalName,
          JSON.parse(new TextDecoder().decode(bytes)) as unknown,
        ).entities;
      }
      const slimArtifact = await buildShardArtifact(
        entityType,
        logicalName,
        expectedShard,
        withoutItemBodies(patched),
        previousDescriptor,
      );
      const bodyArtifact = await buildItemBodyShardArtifact(
        bodyLogicalName,
        patchItemBodies(bodies, changes),
        previousBodyDescriptor,
      );
      nextDescriptors[logicalName] = slimArtifact.descriptor;
      nextDescriptors[bodyLogicalName] = bodyArtifact.descriptor;
      built.push(slimArtifact, bodyArtifact);
      continue;
    }
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

  for (let bucket = 0; bucket < PUBLIC_NUMERIC_SHARD_COUNT; bucket += 1) {
    const entityKey = bucket === 0 ? String(PUBLIC_NUMERIC_SHARD_COUNT) : String(bucket);
    const logicalName = publicItemBodyShardLogicalName(entityKey);
    if (nextDescriptors[logicalName]) continue;
    const artifact = await buildItemBodyShardArtifact(
      logicalName,
      [],
      previous?.artifacts[logicalName],
    );
    nextDescriptors[logicalName] = artifact.descriptor;
    built.push(artifact);
  }

  if (
    input.generatedAtMs === undefined &&
    input.changes.some(({ entityType }) =>
      ["item", "event", "source"].includes(entityType),
    )
  ) {
    for (const logicalName of Object.keys(nextDescriptors)) {
      if (logicalName.startsWith("feeds/")) delete nextDescriptors[logicalName];
    }
  }

  if (input.generatedAtMs !== undefined) {
    const reconstructed = await reconstructCanonicalState(
      nextDescriptors,
      built,
      input.loadArtifact,
    );
    loadedArtifactCount += reconstructed.loadedArtifactCount;
    const bodies = await loadItemBodyLookup(
      reconstructed.state,
      nextDescriptors,
      built,
      input.loadArtifact,
    );
    loadedArtifactCount += bodies.loadedArtifactCount;
    for (const logicalName of Object.keys(nextDescriptors)) {
      if (logicalName.startsWith("views/")) delete nextDescriptors[logicalName];
      if (logicalName.startsWith("feeds/")) delete nextDescriptors[logicalName];
    }
    for (const feed of buildPublicFeedArtifactValues(
      reconstructed.state,
      input.generatedAtMs,
    )) {
      const artifact = await buildMaterializedArtifact(
        feed.logicalName,
        feed.value,
        previous?.artifacts[feed.logicalName],
      );
      nextDescriptors[feed.logicalName] = artifact.descriptor;
      built.push(artifact);
    }
    for (const view of await buildMaterializedPageModels(
      reconstructed.state,
      input.generatedAtMs,
      (id) => bodies.byId.get(id) ?? null,
    )) {
      const artifact = await buildMaterializedArtifact(
        view.logicalName,
        view.value,
        previous?.artifacts[view.logicalName],
      );
      nextDescriptors[view.logicalName] = artifact.descriptor;
      built.push(artifact);
    }
  }

  const identity = await canonicalSha256({
    schemaVersion: 1,
    sourceWatermark: input.sourceWatermark,
    numericShardCount: PUBLIC_NUMERIC_SHARD_COUNT,
    artifacts: nextDescriptors,
  });
  const releaseId = `r${input.sourceWatermark}-${identity.slice(0, 20)}`;
  const manifest = manifestSchema.parse({
    schemaVersion: 1,
    releaseId,
    sourceWatermark: input.sourceWatermark,
    numericShardCount: PUBLIC_NUMERIC_SHARD_COUNT,
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

async function reconstructCanonicalState(
  descriptors: Record<string, ArtifactDescriptor>,
  built: readonly BuiltReleaseArtifact[],
  loadArtifact: BuildPublicReleaseInput["loadArtifact"],
): Promise<{
  state: ReturnType<typeof canonicalStateSchema.parse>;
  loadedArtifactCount: number;
}> {
  const builtByLogicalName = new Map(
    built.map((artifact) => [artifact.logicalName, artifact] as const),
  );
  const entries = Object.entries(descriptors)
    .filter(([logicalName]) => logicalName.startsWith("state/"))
    .sort(([left], [right]) => left.localeCompare(right));
  let loadedArtifactCount = 0;
  const shards = await mapWithConcurrency(entries, 16, async ([logicalName, descriptor]) => {
    const local = builtByLogicalName.get(logicalName);
    const bytes = local?.bytes ?? (await loadArtifact(logicalName, descriptor));
    if (!local) loadedArtifactCount += 1;
    await verifyDescriptorBytes(descriptor, bytes);
    return parsePublicEntityShardValue(
      logicalName,
      JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    );
  });
  const state = {
    schemaVersion: 1 as const,
    items: [] as unknown[],
    events: [] as unknown[],
    sources: [] as unknown[],
    newsletters: [] as unknown[],
    policies: [] as unknown[],
  };
  for (const shard of shards) {
    if (shard.entityType === "item") state.items.push(...shard.entities);
    else if (shard.entityType === "event") state.events.push(...shard.entities);
    else if (shard.entityType === "source") state.sources.push(...shard.entities);
    else if (shard.entityType === "newsletter") state.newsletters.push(...shard.entities);
    else state.policies.push(...shard.entities);
  }
  return { state: canonicalStateSchema.parse(state), loadedArtifactCount };
}

async function loadItemBodyLookup(
  state: ReturnType<typeof canonicalStateSchema.parse>,
  descriptors: Record<string, ArtifactDescriptor>,
  built: readonly BuiltReleaseArtifact[],
  loadArtifact: BuildPublicReleaseInput["loadArtifact"],
): Promise<{ byId: Map<number, string>; loadedArtifactCount: number }> {
  const podcastSourceIds = new Set(
    state.sources
      .filter((source) => source.group === "podcast")
      .map((source) => source.id),
  );
  const logicalNames = [
    ...new Set(
      state.items
        .filter((item) => podcastSourceIds.has(item.sourceId))
        .map((item) => publicItemBodyShardLogicalName(String(item.id))),
    ),
  ].sort();
  const builtByLogicalName = new Map(
    built.map((artifact) => [artifact.logicalName, artifact] as const),
  );
  const shards = await mapWithConcurrency(
    logicalNames,
    16,
    async (logicalName) => {
      const descriptor = descriptors[logicalName];
      if (!descriptor) {
        throw new Error(`missing item body artifact: ${logicalName}`);
      }
      const local = builtByLogicalName.get(logicalName);
      const bytes = local?.bytes ?? (await loadArtifact(logicalName, descriptor));
      await verifyDescriptorBytes(descriptor, bytes);
      return {
        loaded: local === undefined,
        shard: parsePublicItemBodyShardValue(
          logicalName,
          JSON.parse(new TextDecoder().decode(bytes)) as unknown,
        ),
      };
    },
  );
  const byId = new Map<number, string>();
  for (const { shard } of shards) {
    for (const body of shard.entities) byId.set(body.id, body.bodyMd);
  }
  return {
    byId,
    loadedArtifactCount: shards.filter(({ loaded }) => loaded).length,
  };
}

async function buildMaterializedArtifact(
  logicalName: string,
  value: unknown,
  previousDescriptor: ArtifactDescriptor | undefined,
): Promise<BuiltReleaseArtifact> {
  const bytes = canonicalJsonBytes(value);
  const sha256 = await sha256Hex(bytes);
  const descriptor = artifactDescriptorSchema.parse({
    key: objectKey(sha256, "json"),
    sha256,
    byteLength: bytes.byteLength,
    mediaType: "application/json",
    encoding: "utf-8",
    shard: { kind: "singleton" },
  });
  return {
    logicalName,
    descriptor,
    bytes,
    unchanged: previousDescriptor?.sha256 === sha256,
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await map(values[index]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}

type NumericEntityType = Extract<
  PublicEntityType,
  "item" | "event" | "newsletter"
>;
type ItemBody = z.infer<
  typeof publicItemBodyShardSchema
>["entities"][number];

async function buildMigratedNumericArtifacts(
  previous: PublicReleaseManifest,
  changes: readonly PublicEntityChange[],
  loadArtifact: BuildPublicReleaseInput["loadArtifact"],
  migratedEntityTypes: ReadonlySet<NumericEntityType>,
  bodiesAreInline: boolean,
): Promise<{
  artifacts: BuiltReleaseArtifact[];
  loadedArtifactCount: number;
}> {
  const entities: Record<NumericEntityType, Map<string, unknown>> = {
    item: new Map(),
    event: new Map(),
    newsletter: new Map(),
  };
  const bodies = new Map<number, ItemBody>();
  let loadedArtifactCount = 0;
  for (const [logicalName, descriptor] of Object.entries(previous.artifacts)) {
    const entityType = numericEntityTypeFromShardLogicalName(logicalName);
    if (!entityType || !migratedEntityTypes.has(entityType)) continue;
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
      if (shard.entityType === "item") {
        const parsed = publicItemSchema.parse(value);
        if (bodiesAreInline && parsed.bodyMd !== null) {
          bodies.set(parsed.id, { id: parsed.id, bodyMd: parsed.bodyMd });
        }
        destination.set(key, { ...parsed, bodyMd: null });
      } else {
        destination.set(key, value);
      }
    }
  }
  if (migratedEntityTypes.has("item") && !bodiesAreInline) {
    for (const [logicalName, descriptor] of Object.entries(
      previous.artifacts,
    )) {
      if (!logicalName.startsWith("bodies/items/")) continue;
      const bytes = await loadArtifact(logicalName, descriptor);
      loadedArtifactCount += 1;
      await verifyDescriptorBytes(descriptor, bytes);
      for (const body of parsePublicItemBodyShardValue(
        logicalName,
        JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      ).entities) {
        if (bodies.has(body.id)) {
          throw new Error("duplicate item body across prior shards");
        }
        bodies.set(body.id, body);
      }
    }
  }
  for (const change of changes) {
    if (
      !isNumericEntityType(change.entityType) ||
      !migratedEntityTypes.has(change.entityType)
    ) {
      continue;
    }
    const destination = entities[change.entityType];
    if (change.value === null) {
      destination.delete(change.entityKey);
      if (change.entityType === "item") bodies.delete(Number(change.entityKey));
    } else if (change.entityType === "item") {
      const parsed = publicItemSchema.parse(change.value);
      if (String(parsed.id) !== change.entityKey) {
        throw new Error("item key/value mismatch");
      }
      destination.set(change.entityKey, { ...parsed, bodyMd: null });
      if (parsed.bodyMd === null) bodies.delete(parsed.id);
      else bodies.set(parsed.id, { id: parsed.id, bodyMd: parsed.bodyMd });
    } else {
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
    if (!migratedEntityTypes.has(entityType)) continue;
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
  if (migratedEntityTypes.has("item")) {
    const bodiesByLogicalName = new Map<string, ItemBody[]>();
    for (const body of bodies.values()) {
      const logicalName = publicItemBodyShardLogicalName(String(body.id));
      const group = bodiesByLogicalName.get(logicalName) ?? [];
      group.push(body);
      bodiesByLogicalName.set(logicalName, group);
    }
    for (let bucket = 0; bucket < PUBLIC_NUMERIC_SHARD_COUNT; bucket += 1) {
      const entityKey =
        bucket === 0 ? String(PUBLIC_NUMERIC_SHARD_COUNT) : String(bucket);
      const logicalName = publicItemBodyShardLogicalName(entityKey);
      const values = bodiesByLogicalName.get(logicalName) ?? [];
      values.sort((left, right) => left.id - right.id);
      artifacts.push(
        await buildItemBodyShardArtifact(
          logicalName,
          values,
          previous.artifacts[logicalName],
        ),
      );
    }
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

async function buildItemBodyShardArtifact(
  logicalName: string,
  entities: readonly ItemBody[],
  previousDescriptor: ArtifactDescriptor | undefined,
): Promise<BuiltReleaseArtifact> {
  const shard = publicItemBodyShardSchema.parse({
    schemaVersion: 1,
    entityType: "item-body",
    entities,
  });
  parsePublicItemBodyShardValue(logicalName, shard);
  const bytes = canonicalJsonBytes(shard);
  const sha256 = await sha256Hex(bytes);
  const shardMetadata = {
    kind: "id_bucket" as const,
    bucket: logicalName.slice(-2),
  };
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
  if (manifest.numericShardCount !== undefined) {
    return manifest.numericShardCount !== PUBLIC_NUMERIC_SHARD_COUNT;
  }
  const buckets = Object.keys(manifest.artifacts)
    .filter(isNumericShardLogicalName)
    .map((logicalName) => Number.parseInt(logicalName.slice(-2), 16));
  if (buckets.length === 0) return false;
  const inferredShardCount = Math.max(...buckets) >= 16 ? 128 : 16;
  return inferredShardCount !== PUBLIC_NUMERIC_SHARD_COUNT;
}

export function requiresBodySplitMigration(
  manifest: PublicReleaseManifest,
): boolean {
  return manifest.artifacts["bodies/items/00"] === undefined;
}

function isNumericShardLogicalName(logicalName: string): boolean {
  return /^state\/(?:items|events|newsletters)\/[a-f0-9]{2}$/.test(logicalName);
}

function numericEntityTypeFromShardLogicalName(
  logicalName: string,
): NumericEntityType | null {
  if (/^state\/items\/[a-f0-9]{2}$/.test(logicalName)) return "item";
  if (/^state\/events\/[a-f0-9]{2}$/.test(logicalName)) return "event";
  if (/^state\/newsletters\/[a-f0-9]{2}$/.test(logicalName)) {
    return "newsletter";
  }
  return null;
}

function isMigratedNumericShardLogicalName(
  logicalName: string,
  migratedEntityTypes: ReadonlySet<NumericEntityType>,
): boolean {
  const entityType = numericEntityTypeFromShardLogicalName(logicalName);
  return entityType !== null && migratedEntityTypes.has(entityType);
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

function withoutItemBodies(values: readonly unknown[]): unknown[] {
  return values.map((value) => ({ ...publicItemSchema.parse(value), bodyMd: null }));
}

function patchItemBodies(
  previous: readonly ItemBody[],
  changes: readonly PublicEntityChange[],
): ItemBody[] {
  const bodies = new Map(previous.map((body) => [body.id, body] as const));
  for (const change of changes) {
    if (change.entityType !== "item") {
      throw new Error("mixed entity types in item body shard patch");
    }
    const id = Number(change.entityKey);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error("invalid item key");
    }
    if (change.value === null) {
      bodies.delete(id);
      continue;
    }
    const parsed = publicItemSchema.parse(change.value);
    if (parsed.id !== id) throw new Error("item key/value mismatch");
    if (parsed.bodyMd === null) bodies.delete(id);
    else bodies.set(id, { id, bodyMd: parsed.bodyMd });
  }
  return [...bodies.values()].sort((left, right) => left.id - right.id);
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
