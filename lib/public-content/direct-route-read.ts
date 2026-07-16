import {
  PUBLIC_FEED_DIRECTORY_LOGICAL_NAME,
  parsePublicFeedDirectory,
  parsePublicFeedSegment,
  publicFeedApiItemFromStory,
  publicFeedDefaultLogicalName,
  publicFeedRowId,
  publicFeedRowPublishedAt,
  queryPublicFeedRows,
  selectPublicFeedSegmentLogicalNames,
  type PublicFeedDirectory,
  type PublicFeedRow,
} from "@/lib/public-content/feed-artifacts";
import {
  PUBLIC_NUMERIC_SHARD_COUNT,
  parsePublicEntityShardValue,
  parsePublicItemBodyShardValue,
  publicEntityShardLogicalName,
  publicItemBodyShardLogicalName,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import {
  publicStoryFromItem,
  type PublicStateIndex,
} from "@/lib/public-content/public-items";
import type { PublicFeedQuery } from "@/lib/public-content/query";
import type {
  PublicReleaseReadScope,
  ResolvedPublicRelease,
} from "@/lib/public-content/reader/types";
import { APP_LOCALES, type Story } from "@/lib/types";

export type DirectPublicFeedResult = {
  stories: Story[];
  total: number;
  limit: number;
  offset: number;
  view: "archive" | "today";
};

export type DirectPublicItemRead = {
  index: Pick<PublicStateIndex, "itemsById" | "eventsById" | "sourcesById">;
  item: CanonicalPublicState["items"][number];
  source: CanonicalPublicState["sources"][number];
  event: CanonicalPublicState["events"][number] | null;
  bodyMd: string | null;
};

export function supportsDirectPublicRouteReads(
  release: ResolvedPublicRelease,
): boolean {
  return (
    release.manifest.numericShardCount === PUBLIC_NUMERIC_SHARD_COUNT &&
    release.manifest.artifacts[PUBLIC_FEED_DIRECTORY_LOGICAL_NAME] !== undefined &&
    APP_LOCALES.every(
      (locale) =>
        release.manifest.artifacts[publicFeedDefaultLogicalName(locale)] !==
        undefined,
    )
  );
}

export async function readDirectPublicFeedStories(
  scope: PublicReleaseReadScope,
  query: PublicFeedQuery,
  nowMs: number,
): Promise<DirectPublicFeedResult> {
  let directory: PublicFeedDirectory | undefined;
  await scope.readLogicalArtifact(PUBLIC_FEED_DIRECTORY_LOGICAL_NAME, {
    required: true,
    validate: (bytes) => {
      directory = parsePublicFeedDirectory(bytes);
    },
  });
  assertCompleteFeedDirectory(scope, directory!);

  const logicalNames = selectPublicFeedSegmentLogicalNames(directory!, query, {
    nowMs,
  });
  const directoryByName = new Map(
    directory!.segments.map((segment) => [segment.logicalName, segment]),
  );
  const rowShards = await mapWithConcurrency(
    logicalNames,
    16,
    async (logicalName) => {
      let rows: PublicFeedRow[] | undefined;
      await scope.readLogicalArtifact(logicalName, {
        required: true,
        validate: (bytes) => {
          const segment = parsePublicFeedSegment(logicalName, bytes);
          const expected = directoryByName.get(logicalName);
          const published = segment.rows
            .map(publicFeedRowPublishedAt)
            .sort();
          if (
            segment.rows.length !== expected?.count ||
            published[0] !== expected.minPublishedAt ||
            published.at(-1) !== expected.maxPublishedAt
          ) {
            throw new Error(`public feed segment directory mismatch: ${logicalName}`);
          }
          rows = segment.rows;
        },
      });
      return rows!;
    },
  );
  const rows = rowShards.flat();
  if (new Set(rows.map(publicFeedRowId)).size !== rows.length) {
    return scope.rejectRelease(new Error("duplicate public feed row"));
  }

  const selected = queryPublicFeedRows(rows, query, { nowMs });
  const ids = selected.items.map(({ id }) => Number(id));
  const stories = await hydrateStories(scope, ids, selected.items, query, nowMs);
  return {
    stories,
    total: selected.total,
    limit: selected.limit,
    offset: selected.offset,
    view: selected.view,
  };
}

export async function readDirectPublicNewsletters(
  scope: PublicReleaseReadScope,
): Promise<CanonicalPublicState["newsletters"]> {
  const logicalNames = Object.keys(scope.release.manifest.artifacts)
    .filter((logicalName) => logicalName.startsWith("state/newsletters/"))
    .sort();
  const shards = await mapWithConcurrency(logicalNames, 16, async (logicalName) => {
    let rows: CanonicalPublicState["newsletters"] | undefined;
    await scope.readLogicalArtifact(logicalName, {
      required: true,
      validate: (bytes) => {
        const shard = parseEntityShard(logicalName, bytes);
        if (shard.entityType !== "newsletter") {
          throw new Error("public newsletter artifact has the wrong entity type");
        }
        rows = shard.entities;
      },
    });
    return rows!;
  });
  const newsletters = shards.flat();
  if (new Set(newsletters.map(({ id }) => id)).size !== newsletters.length) {
    return scope.rejectRelease(new Error("duplicate public newsletter row"));
  }
  return newsletters;
}

export async function readDirectPublicSources(
  scope: PublicReleaseReadScope,
): Promise<CanonicalPublicState["sources"]> {
  let sources: CanonicalPublicState["sources"] | undefined;
  await scope.readLogicalArtifact("state/sources", {
    required: true,
    validate: (bytes) => {
      const shard = parseEntityShard("state/sources", bytes);
      if (shard.entityType !== "source") {
        throw new Error("public sources artifact has the wrong entity type");
      }
      sources = shard.entities;
    },
  });
  return sources!;
}

export async function readDirectPublicItem(
  scope: PublicReleaseReadScope,
  id: number,
): Promise<DirectPublicItemRead | null> {
  const itemLogicalName = publicEntityShardLogicalName("item", String(id));
  const item = (await readEntityRows(scope, itemLogicalName, "item")).find(
    (candidate) => candidate.id === id,
  );
  if (!item) return null;

  const [sources, events, bodyMd] = await Promise.all([
    readDirectPublicSources(scope),
    item.eventId === null
      ? Promise.resolve([])
      : readEntityRows(
          scope,
          publicEntityShardLogicalName("event", String(item.eventId)),
          "event",
        ),
    readDirectPublicItemBody(scope, id),
  ]);
  const source = sources.find((candidate) => candidate.id === item.sourceId);
  if (!source) {
    return scope.rejectRelease(
      new Error(`missing direct public item source: ${item.sourceId}`),
    );
  }
  const event =
    item.eventId === null
      ? null
      : events.find((candidate) => candidate.id === item.eventId) ?? null;
  if (
    item.eventId !== null &&
    (!event || !event.memberItemIds.includes(item.id))
  ) {
    return scope.rejectRelease(
      new Error(`missing direct public item event: ${item.eventId}`),
    );
  }
  return {
    index: {
      itemsById: new Map([[item.id, item]]),
      eventsById: event ? new Map([[event.id, event]]) : new Map(),
      sourcesById: new Map(sources.map((candidate) => [candidate.id, candidate])),
    },
    item,
    source,
    event,
    bodyMd,
  };
}

function assertCompleteFeedDirectory(
  scope: PublicReleaseReadScope,
  directory: PublicFeedDirectory,
): void {
  const declared = directory.segments.map(({ logicalName }) => logicalName).sort();
  const manifest = Object.keys(scope.release.manifest.artifacts)
    .filter((logicalName) => logicalName.startsWith("feeds/segments/"))
    .sort();
  if (
    new Set(declared).size !== declared.length ||
    declared.length !== manifest.length ||
    declared.some((logicalName, index) => logicalName !== manifest[index])
  ) {
    scope.rejectRelease(new Error("public feed directory is incomplete"));
  }
}

async function hydrateStories(
  scope: PublicReleaseReadScope,
  ids: readonly number[],
  expectedItems: ReturnType<typeof queryPublicFeedRows>["items"],
  query: PublicFeedQuery,
  nowMs: number,
): Promise<Story[]> {
  if (ids.length === 0) return [];
  const wantedIds = new Set(ids);
  const itemLogicalNames = [
    ...new Set(ids.map((id) => publicEntityShardLogicalName("item", String(id)))),
  ];
  const [sources, itemShards] = await Promise.all([
    readDirectPublicSources(scope),
    mapWithConcurrency(itemLogicalNames, 16, (logicalName) =>
      readEntityRows(scope, logicalName, "item"),
    ),
  ]);
  const items = itemShards.flat().filter(({ id }) => wantedIds.has(id));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  if (itemsById.size !== ids.length) {
    return scope.rejectRelease(new Error("missing public feed item"));
  }

  const eventIds = [
    ...new Set(
      items
        .map(({ eventId }) => eventId)
        .filter((id): id is number => id !== null),
    ),
  ];
  const wantedEventIds = new Set(eventIds);
  const eventLogicalNames = [
    ...new Set(
      eventIds.map((id) => publicEntityShardLogicalName("event", String(id))),
    ),
  ];
  const eventShards = await mapWithConcurrency(eventLogicalNames, 16, (logicalName) =>
    readEntityRows(scope, logicalName, "event"),
  );
  const events = eventShards.flat().filter(({ id }) => wantedEventIds.has(id));
  const eventsById = new Map(events.map((event) => [event.id, event]));
  if (eventsById.size !== eventIds.length) {
    return scope.rejectRelease(new Error("missing public feed event"));
  }
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const index: PublicStateIndex = {
    state: directState({ items, events, sources }),
    itemsById,
    eventsById,
    sourcesById,
  };
  const locale = query.locale ?? "zh";

  return ids.map((id, indexInPage) => {
    const item = itemsById.get(id)!;
    const source = sourcesById.get(item.sourceId);
    const event = item.eventId === null ? undefined : eventsById.get(item.eventId);
    if (!source || (item.eventId !== null && !event)) {
      return scope.rejectRelease(new Error("missing public feed relation"));
    }
    if (
      event &&
      (event.leadItemId !== item.id || !event.memberItemIds.includes(item.id))
    ) {
      return scope.rejectRelease(new Error("invalid public feed event relation"));
    }
    const validationStory = publicStoryFromItem(index, item, {
      locale,
      includeSourceGroup: true,
      nowMs,
      hotWindowHours: query.hotWindowHours,
    });
    if (
      JSON.stringify(publicFeedApiItemFromStory(validationStory, locale)) !==
      JSON.stringify(expectedItems[indexInPage])
    ) {
      return scope.rejectRelease(new Error("public feed metadata mismatch"));
    }
    return query.includeSourceGroup
      ? validationStory
      : publicStoryFromItem(index, item, {
          locale,
          nowMs,
          hotWindowHours: query.hotWindowHours,
        });
  });
}

async function readEntityRows<T extends "item" | "event">(
  scope: PublicReleaseReadScope,
  logicalName: string,
  entityType: T,
): Promise<CanonicalPublicState[`${T}s`]> {
  let rows: CanonicalPublicState[`${T}s`] | undefined;
  await scope.readLogicalArtifact(logicalName, {
    required: true,
    validate: (bytes) => {
      const shard = parseEntityShard(logicalName, bytes);
      if (shard.entityType !== entityType) {
        throw new Error(`public ${entityType} artifact has the wrong entity type`);
      }
      rows = shard.entities as CanonicalPublicState[`${T}s`];
    },
  });
  return rows!;
}

async function readDirectPublicItemBody(
  scope: PublicReleaseReadScope,
  id: number,
): Promise<string | null> {
  const logicalName = publicItemBodyShardLogicalName(String(id));
  let bodyMd: string | null | undefined;
  await scope.readLogicalArtifact(logicalName, {
    required: true,
    validate: (bytes) => {
      const shard = parsePublicItemBodyShardValue(
        logicalName,
        JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      );
      bodyMd = shard.entities.find((entity) => entity.id === id)?.bodyMd ?? null;
    },
  });
  return bodyMd!;
}

function parseEntityShard(logicalName: string, bytes: Uint8Array) {
  return parsePublicEntityShardValue(
    logicalName,
    JSON.parse(new TextDecoder().decode(bytes)) as unknown,
  );
}

function directState(
  input: Partial<Pick<CanonicalPublicState, "items" | "events" | "sources" | "newsletters" | "policies">>,
): CanonicalPublicState {
  return {
    schemaVersion: 1,
    items: input.items ?? [],
    events: input.events ?? [],
    sources: input.sources ?? [],
    newsletters: input.newsletters ?? [],
    policies: input.policies ?? [],
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
