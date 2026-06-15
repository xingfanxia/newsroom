import { describe, expect, test } from "bun:test";
import {
  HIGHLIGHT_ITEM_TIERS,
  isHighlightItemTier,
  isVisibleItemTier,
  VISIBLE_ITEM_TIERS,
} from "@/lib/types";
import { readSource } from "@/tests/helpers/source";

const types = readSource("lib/types.ts");
const feedParams = readSource("lib/api/feed-query-params.ts");
const mcpRoute = readSource("app/api/mcp/route.ts");
const sourcePresets = readSource("app/[locale]/_source-presets.ts");
const storyItemFields = readSource("lib/api/story-item-fields.ts");
const leadPick = readSource("workers/cluster/lead-pick.ts");
const recomputeClusterLeads = readSource(
  "scripts/migrations/recompute-cluster-leads.ts",
);
const homePage = readSource("app/[locale]/page.tsx");
const allPage = readSource("app/[locale]/all/page.tsx");
const liveItems = readSource("lib/items/live.ts");
const itemDetail = readSource("lib/items/detail.ts");
const savedItems = readSource("lib/items/saved.ts");
const semanticSearch = readSource("lib/items/semantic-search.ts");
const storyMapper = readSource("lib/items/story-mapper.ts");
const enrichTreatment = readSource("workers/enrich/treatment.ts");
const enrichPrompt = readSource("workers/enrich/prompt.ts");
const itemCommentary = readSource("workers/enrich/commentary.ts");
const eventCommentary = readSource("workers/cluster/commentary.ts");
const backfillStyle = readSource("scripts/ops/backfill-style.ts");
const backfillChinese = readSource("scripts/ops/backfill-chinese.ts");
const resetCuratedForBackfill = readSource(
  "scripts/ops/reset-curated-for-backfill.ts",
);
const regenCommentaryPreview = readSource(
  "scripts/ops/regen-commentary-preview.ts",
);

describe("feed tier/view source wiring", () => {
  test("feed-facing filter enums have one runtime source of truth", () => {
    expect(types).toContain("export const ITEM_TIERS");
    expect(types).toContain("export const VISIBLE_ITEM_TIERS");
    expect(types).toContain("export const HIGHLIGHT_ITEM_TIERS");
    expect(types).toContain("export function isVisibleItemTier");
    expect(types).toContain("export function isHighlightItemTier");
    expect(types).toContain("export const FEED_VIEWS");
    expect(types).toContain("export const SOURCE_GROUPS");
    expect(types).toContain("export const SOURCE_KINDS");
    expect(types).toContain("export const SEARCH_MODES");
  });

  test("highlight tier helpers encode the featured/p1 subset once", () => {
    expect(VISIBLE_ITEM_TIERS).toEqual(["featured", "p1", "all"]);
    expect(HIGHLIGHT_ITEM_TIERS).toEqual(["featured", "p1"]);
    expect(isVisibleItemTier("all")).toBe(true);
    expect(isVisibleItemTier("excluded")).toBe(false);
    expect(isHighlightItemTier("featured")).toBe(true);
    expect(isHighlightItemTier("p1")).toBe(true);
    expect(isHighlightItemTier("all")).toBe(false);
  });

  test("feed-facing schemas use shared visible tiers, views, and source filters", () => {
    expect(feedParams).toContain("VISIBLE_ITEM_TIERS");
    expect(feedParams).toContain("FEED_VIEWS");
    expect(feedParams).toContain("SOURCE_GROUPS");
    expect(feedParams).toContain("SOURCE_KINDS");
    expect(feedParams).toContain("mcpFeedToolInputShape");
    expect(feedParams).toContain("z.enum(VISIBLE_ITEM_TIERS)");
    expect(feedParams).toContain("z.enum(FEED_VIEWS)");
    expect(feedParams).toContain("z.enum(SOURCE_GROUPS)");
    expect(feedParams).toContain("z.enum(SOURCE_KINDS)");
    expect(feedParams).not.toContain('z.enum(["featured", "p1", "all"])');
    expect(feedParams).not.toContain('z.enum(["today", "archive"])');
    expect(feedParams).not.toContain("source_group: z.string().min(1)");
    expect(feedParams).not.toContain("source_kind: z.string().min(1)");
    expect(feedParams).not.toContain("source_group: z.string().optional()");
    expect(feedParams).not.toContain("source_kind: z.string().optional()");

    expect(mcpRoute).toContain("mcpFeedToolInputShape");
    expect(mcpRoute).not.toContain("z.enum(VISIBLE_ITEM_TIERS)");
    expect(mcpRoute).not.toContain("z.enum(FEED_VIEWS)");
    expect(mcpRoute).not.toContain("z.enum(SOURCE_GROUPS)");
    expect(mcpRoute).not.toContain("z.enum(SOURCE_KINDS)");
  });

  test("search-facing schemas use the shared mode tuple", () => {
    expect(feedParams).toContain("SEARCH_MODES");
    expect(feedParams).toContain("mcpSearchToolInputShape");
    expect(feedParams).toContain("z.enum(SEARCH_MODES)");
    expect(feedParams).not.toContain('z.enum(["lexical", "semantic"])');

    expect(mcpRoute).toContain("mcpSearchToolInputShape");
    expect(mcpRoute).not.toContain("z.enum(SEARCH_MODES)");
  });

  test("UI source preset filters map through one typed helper", () => {
    expect(sourcePresets).toContain('Pick<FeedQuery, "sourceGroup" | "sourceKind">');
    expect(sourcePresets).toContain("sourcePresetToFeedFilter");

    for (const source of [homePage, allPage]) {
      expect(source).toContain("coerceSourcePreset");
      expect(source).toContain("sourcePresetToFeedFilter");
      expect(source).not.toContain("function presetToFilter");
      expect(source).not.toContain("new Set<SourcePreset>");
      expect(source).not.toContain(
        "): { sourceGroup?: string; sourceKind?: string }",
      );
    }
  });

  test("internal feed and commentary contracts use shared tier types", () => {
    expect(liveItems).toContain("VisibleItemTier");
    expect(liveItems).toContain("FeedView");
    expect(enrichPrompt).toContain("z.enum(ITEM_TIERS)");
    expect(itemCommentary).toContain("VISIBLE_ITEM_TIERS");
    expect(eventCommentary).toContain("VISIBLE_ITEM_TIERS");
  });

  test("highlight tier decisions use the shared helper", () => {
    for (const source of [
      storyMapper,
      enrichTreatment,
      itemCommentary,
      eventCommentary,
      backfillStyle,
      backfillChinese,
    ]) {
      expect(source).toContain("isHighlightItemTier");
      expect(source).not.toMatch(
        /(?:tier|eventTier|effectiveTier|r\.tier|item\.tier|c\.eventTier) === "featured" \|\| (?:tier|eventTier|effectiveTier|r\.tier|item\.tier|c\.eventTier) === "p1"/,
      );
    }

    for (const source of [
      liveItems,
      itemDetail,
      savedItems,
      semanticSearch,
    ]) {
      expect(source).toContain("@/lib/items/story-mapper");
      expect(source).not.toContain("isHighlightItemTier");
    }
  });

  test("operator commentary scripts reuse visible tier tuples", () => {
    for (const source of [
      backfillStyle,
      resetCuratedForBackfill,
      regenCommentaryPreview,
    ]) {
      expect(source).toContain("VISIBLE_ITEM_TIERS");
      expect(source).not.toContain('["featured", "p1", "all"]');
    }
    expect(backfillStyle).toContain("HIGHLIGHT_ITEM_TIERS");
    expect(backfillStyle).toContain("isVisibleItemTier");
  });

  test("public item and lead-pick source contracts use shared source types", () => {
    expect(storyItemFields).toContain("SourceGroup");
    expect(storyItemFields).toContain("SourceKind");
    expect(storyItemFields).toContain("source_group: SourceGroup | null");
    expect(storyItemFields).toContain("source_kind: SourceKind");
    expect(storyItemFields).not.toContain("source_group: string | null");
    expect(storyItemFields).not.toContain("source_kind: string");

    expect(leadPick).toContain('import type { SourceGroup } from "@/lib/types"');
    expect(leadPick).not.toContain("sourceGroupEnum");
    expect(leadPick).toContain("satisfies Record<SourceGroup, number>");

    expect(recomputeClusterLeads).toContain(
      'import type { SourceGroup } from "@/lib/types"',
    );
    expect(recomputeClusterLeads).not.toContain(
      'type SourceGroup } from "@/workers/cluster/lead-pick"',
    );
  });
});
