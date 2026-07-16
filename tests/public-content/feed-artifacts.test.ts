import { describe, expect, test } from "bun:test";
import { canonicalJsonBytes } from "@/lib/public-content/canonical";
import {
  buildPublicFeedArtifactValues,
  parsePublicFeedDirectory,
  publicFeedApiItemFromStory,
  publicFeedDefaultLogicalName,
  publicFeedRowsFromState,
  queryPublicFeedRows,
} from "@/lib/public-content/feed-artifacts";
import type { CanonicalPublicState } from "@/lib/public-content/contracts";
import { buildPublicRelease } from "@/lib/public-content/publisher/build-release";
import type { PublicEntityChange } from "@/lib/public-content/publisher/types";
import {
  queryPublicFeed,
  type PublicFeedQuery,
} from "@/lib/public-content/query";
import {
  PARITY_NOW_MS,
  PARITY_STATE,
} from "./fixtures/parity-corpus";

describe("compact public feed artifacts", () => {
  test("preserves exact canonical feed results across the public query matrix", () => {
    const rows = publicFeedRowsFromState(PARITY_STATE, PARITY_NOW_MS);
    const cases: PublicFeedQuery[] = [
      {},
      { locale: "en" },
      { locale: "zh" },
      { tier: "all", limit: 100 },
      { tier: "p1", limit: 100 },
      {
        tier: "all",
        sourceId: "beta-x",
        sourceGroup: "podcast",
        sourceKind: "rss",
        limit: 100,
      },
      { tier: "all", sourceGroup: "media", limit: 100 },
      { tier: "all", sourceKind: "api", limit: 100 },
      { tier: "all", curatedOnly: true, limit: 100 },
      { tier: "all", includeSourceTags: ["preferred"], limit: 100 },
      { tier: "all", excludeSourceTags: ["blocked"], limit: 100 },
      { tier: "all", date: "2026-07-13", limit: 100 },
      {
        tier: "all",
        dateFrom: "2026-07-13T21:00:00.000Z",
        dateTo: "2026-07-14T10:00:00.000Z",
        limit: 100,
      },
      { tier: "all", view: "today", hotWindowHours: 24, limit: 100 },
      { tier: "all", offset: 2, limit: 3 },
      { tier: "all", offset: 2, limit: 0 },
      { tier: "all", maxPerDay: 2, limit: 4 },
      {
        tier: "all",
        minImportance: 90,
        recentDayRescueDays: 1,
        limit: 100,
      },
      { tier: "all", recencyFloorDays: 2, limit: 100 },
    ];

    for (const input of cases) {
      const query = { ...input, includeSourceGroup: true };
      const canonical = queryPublicFeed(PARITY_STATE, query, {
        nowMs: PARITY_NOW_MS,
      });
      const expected = {
        ...canonical,
        items: canonical.items.map((story) =>
          publicFeedApiItemFromStory(story, query.locale ?? "zh"),
        ),
      };
      expect(
        queryPublicFeedRows(rows, query, { nowMs: PARITY_NOW_MS }),
      ).toEqual(expected);
    }
  });

  test("emits bounded defaults plus independently addressed month buckets", () => {
    const artifacts = buildPublicFeedArtifactValues(
      PARITY_STATE,
      PARITY_NOW_MS,
    );
    expect(artifacts.map(({ logicalName }) => logicalName)).toEqual([
      "feeds/segments/2026-07/0",
      "feeds/segments/2026-07/1",
      "feeds/segments/2026-07/2",
      "feeds/segments/2026-07/3",
      "feeds/directory",
      publicFeedDefaultLogicalName("zh"),
      publicFeedDefaultLogicalName("en"),
    ]);
    const serializedDefaults = artifacts
      .filter(({ logicalName }) => logicalName.startsWith("feeds/default/"))
      .map(({ value }) => JSON.stringify(value).length);
    expect(Math.max(...serializedDefaults)).toBeLessThanOrEqual(500 * 1024);
  });

  test("rejects mismatched, duplicate, and reversed directory metadata", () => {
    const directory = buildPublicFeedArtifactValues(
      PARITY_STATE,
      PARITY_NOW_MS,
    ).find(({ logicalName }) => logicalName === "feeds/directory")!.value as {
      segments: Array<Record<string, unknown>>;
    };
    const first = directory.segments[0]!;
    const cases = [
      {
        ...directory,
        segments: [{ ...first, month: "2025-01" }, ...directory.segments.slice(1)],
      },
      {
        ...directory,
        segments: [first, first, ...directory.segments.slice(1)],
      },
      {
        ...directory,
        segments: [
          {
            ...first,
            minPublishedAt: "2026-07-15T00:00:00.000Z",
            maxPublishedAt: "2026-07-14T00:00:00.000Z",
          },
          ...directory.segments.slice(1),
        ],
      },
    ];
    for (const value of cases) {
      expect(() => parsePublicFeedDirectory(canonicalJsonBytes(value))).toThrow();
    }
  });

  test("migrates below 500 writes and reuses every unaffected feed artifact", async () => {
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
    const migratedFeedArtifacts = migrate.artifacts.filter(({ logicalName }) =>
      logicalName.startsWith("feeds/"),
    );
    expect(migratedFeedArtifacts.length).toBe(7);
    expect(migratedFeedArtifacts.every(({ unchanged }) => !unchanged)).toBeTrue();
    for (const artifact of migrate.artifacts) {
      objectBytes.set(artifact.descriptor.key, artifact.bytes);
    }

    const priorItem = PARITY_STATE.items.find(({ id }) => id === 7)!;
    const updatedItem = {
      ...priorItem,
      title: { ...priorItem.title, en: "Updated historical signal" },
    };
    const next = await buildPublicRelease({
      previousManifest: migrate.manifest,
      sourceWatermark: 21,
      changes: [
        {
          entityType: "item",
          entityKey: "7",
          value: updatedItem,
        },
      ],
      generatedAtMs: PARITY_NOW_MS + 60_000,
      loadArtifact: loadFrom(objectBytes),
    });
    const nextFeedArtifacts = next.artifacts.filter(({ logicalName }) =>
      logicalName.startsWith("feeds/"),
    );
    expect(
      nextFeedArtifacts
        .filter(({ unchanged }) => !unchanged)
        .map(({ logicalName }) => logicalName),
    ).toEqual(["feeds/segments/2026-07/3"]);
    expect(nextFeedArtifacts.filter(({ unchanged }) => unchanged)).toHaveLength(6);
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
