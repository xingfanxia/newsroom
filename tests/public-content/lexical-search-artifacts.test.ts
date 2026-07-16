import { describe, expect, test } from "bun:test";
import {
  buildPublicLexicalArtifactValues,
  PUBLIC_LEXICAL_SHARD_COUNT,
  publicLexicalRowsFromState,
  publicLexicalShardLogicalName,
  queryPublicLexicalRows,
} from "@/lib/public-content/lexical-search-artifacts";
import {
  queryPublicFeed,
  type PublicFeedQuery,
} from "@/lib/public-content/query";
import type { CanonicalPublicState } from "@/lib/public-content/contracts";
import { buildPublicRelease } from "@/lib/public-content/publisher/build-release";
import type { PublicEntityChange } from "@/lib/public-content/publisher/types";
import {
  PARITY_NOW_MS,
  PARITY_STATE,
} from "./fixtures/parity-corpus";

describe("compact public lexical search artifacts", () => {
  test("preserves canonical SQLite-LIKE matching, filters, ordering and pagination", () => {
    const rows = publicLexicalRowsFromState(PARITY_STATE);
    const cases: PublicFeedQuery[] = [
      { searchText: "Alpha", tier: "all", limit: 100 },
      { searchText: "alpha", tier: "all", limit: 100 },
      { searchText: "a_00", tier: "all", limit: 50 },
      { searchText: "%", tier: "all", limit: 100 },
      { searchText: "_", tier: "all", limit: 100 },
      { searchText: "Alpha", tier: "featured", limit: 100 },
      { searchText: "Alpha", tier: "p1", limit: 100 },
      {
        searchText: "Alpha",
        tier: "all",
        sourceId: "alpha-podcast",
        sourceGroup: "media",
        sourceKind: "api",
        limit: 100,
      },
      {
        searchText: "Alpha",
        tier: "all",
        sourceGroup: "podcast",
        limit: 100,
      },
      {
        searchText: "Alpha",
        tier: "all",
        sourceKind: "rss",
        limit: 100,
      },
      {
        searchText: "Alpha",
        tier: "all",
        date: "2026-07-13",
        limit: 100,
      },
      {
        searchText: "Alpha",
        tier: "all",
        dateFrom: "2026-07-13T21:00:00.000Z",
        dateTo: "2026-07-14T10:00:00.000Z",
        limit: 100,
      },
      { searchText: "Alpha", tier: "all", offset: 1, limit: 1 },
    ];

    for (const query of cases) {
      const canonical = queryPublicFeed(PARITY_STATE, query, {
        nowMs: PARITY_NOW_MS,
      });
      const compact = queryPublicLexicalRows(rows, query, {
        nowMs: PARITY_NOW_MS,
      });
      expect(compact).toEqual({
        ids: canonical.items.map(({ id }) => Number(id)),
        total: canonical.total,
        limit: canonical.limit,
        offset: canonical.offset,
      });
    }
  });

  test("emits a fixed complete family with no singleton full index", () => {
    const artifacts = buildPublicLexicalArtifactValues(PARITY_STATE);
    expect(artifacts).toHaveLength(PUBLIC_LEXICAL_SHARD_COUNT);
    expect(artifacts.map(({ logicalName }) => logicalName)).toEqual(
      Array.from({ length: PUBLIC_LEXICAL_SHARD_COUNT }, (_, bucket) =>
        publicLexicalShardLogicalName(bucket),
      ),
    );
    expect(new Set(publicLexicalRowsFromState(PARITY_STATE).map((row) => row[0])).size)
      .toBe(
        queryPublicFeed(
          PARITY_STATE,
          { tier: "all", limit: PARITY_STATE.items.length },
          { nowMs: PARITY_NOW_MS },
        ).total,
      );
  });

  test("migrates within the write cap and changes only the affected item bucket", async () => {
    const legacy = await buildPublicRelease({
      previousManifest: null,
      sourceWatermark: 20,
      changes: allChanges(PARITY_STATE),
      loadArtifact: missingPriorArtifact,
    });
    const objectBytes = new Map(
      legacy.artifacts.map(({ descriptor, bytes }) => [descriptor.key, bytes]),
    );
    const migrate = await buildPublicRelease({
      previousManifest: legacy.manifest,
      sourceWatermark: 20,
      changes: [],
      generatedAtMs: PARITY_NOW_MS,
      loadArtifact: loadFrom(objectBytes),
    });
    expect(
      migrate.artifacts.filter(({ unchanged }) => !unchanged).length + 3,
    ).toBeLessThanOrEqual(500);
    const migratedSearch = migrate.artifacts.filter(({ logicalName }) =>
      logicalName.startsWith("search/lexical/"),
    );
    expect(migratedSearch).toHaveLength(PUBLIC_LEXICAL_SHARD_COUNT);
    expect(migratedSearch.every(({ unchanged }) => !unchanged)).toBeTrue();
    for (const artifact of migrate.artifacts) {
      objectBytes.set(artifact.descriptor.key, artifact.bytes);
    }

    const priorItem = PARITY_STATE.items.find(({ id }) => id === 7)!;
    const next = await buildPublicRelease({
      previousManifest: migrate.manifest,
      sourceWatermark: 21,
      changes: [
        {
          entityType: "item",
          entityKey: "7",
          value: {
            ...priorItem,
            title: { ...priorItem.title, en: "Updated lexical signal" },
          },
        },
      ],
      generatedAtMs: PARITY_NOW_MS + 60_000,
      loadArtifact: loadFrom(objectBytes),
    });
    const nextSearch = next.artifacts.filter(({ logicalName }) =>
      logicalName.startsWith("search/lexical/"),
    );
    expect(
      nextSearch
        .filter(({ unchanged }) => !unchanged)
        .map(({ logicalName }) => logicalName),
    ).toEqual([publicLexicalShardLogicalName(7)]);
    expect(nextSearch.filter(({ unchanged }) => unchanged)).toHaveLength(
      PUBLIC_LEXICAL_SHARD_COUNT - 1,
    );
  });
});

function loadFrom(objectBytes: ReadonlyMap<string, Uint8Array>) {
  return async (_logicalName: string, descriptor: { key: string }) => {
    const bytes = objectBytes.get(descriptor.key);
    if (!bytes) throw new Error(`missing fixture object: ${descriptor.key}`);
    return bytes;
  };
}

async function missingPriorArtifact(): Promise<never> {
  throw new Error("fixture cannot load a prior artifact");
}

function allChanges(state: CanonicalPublicState): PublicEntityChange[] {
  return [
    ...state.sources.map((value) => ({
      entityType: "source" as const,
      entityKey: value.id,
      value,
    })),
    ...state.items.map((value) => ({
      entityType: "item" as const,
      entityKey: String(value.id),
      value,
    })),
    ...state.events.map((value) => ({
      entityType: "event" as const,
      entityKey: String(value.id),
      value,
    })),
    ...state.newsletters.map((value) => ({
      entityType: "newsletter" as const,
      entityKey: String(value.id),
      value,
    })),
    ...state.policies.map((value) => ({
      entityType: "policy" as const,
      entityKey: value.skillName,
      value,
    })),
  ];
}
