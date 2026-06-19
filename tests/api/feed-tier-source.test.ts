import { describe, expect, test } from "bun:test";
import {
  HIGHLIGHT_ITEM_TIERS,
  isHighlightItemTier,
  isVisibleItemTier,
  VISIBLE_ITEM_TIERS,
} from "@/lib/types";
import { readSource } from "@/tests/helpers/source";

const types = readSource("lib/types.ts");
const tierSql = readSource("lib/items/tier-sql.ts");
const feedParams = readSource("lib/api/feed-query-params.ts");
const mcpRoute = readSource("app/api/mcp/route.ts");
const sourcePresets = readSource("lib/feed/source-presets.ts");
const homeFilterContracts = readSource("lib/feed/home-filters.ts");
const homeFilters = readSource("app/[locale]/_home-filters.tsx");
const podcastsPage = readSource("app/[locale]/podcasts/page.tsx");
const sourcesPage = readSource("app/[locale]/sources/page.tsx");
const sourcesViewToggle = readSource("app/[locale]/sources/_view-toggle.tsx");
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
const enrichWorker = readSource("workers/enrich/index.ts");
const systemStats = readSource("lib/shell/system-stats.ts");
const dashboardStats = readSource("lib/shell/dashboard-stats.ts");
const ticker = readSource("lib/shell/ticker.ts");
const backfillStyle = readSource("scripts/ops/backfill-style.ts");
const backfillChinese = readSource("scripts/ops/backfill-chinese.ts");
const checkDataState = readSource("scripts/ops/check-data-state.ts");
const seedFeedbackFixture = readSource(
  "scripts/ops/seed-feedback-fixture.ts",
);
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

  test("highlight tier SQL predicates reuse the shared tuple", () => {
    expect(tierSql).toContain("HIGHLIGHT_ITEM_TIERS");
    expect(tierSql).toContain("highlightTierSqlList");
    expect(tierSql).toContain("highlightTierInSql");
    expect(tierSql).not.toMatch(/IN\s*\(\s*'featured'\s*,\s*'p1'\s*\)/i);

    for (const source of [
      liveItems,
      dashboardStats,
      ticker,
      checkDataState,
      seedFeedbackFixture,
    ]) {
      expect(source).toContain("highlightTierInSql");
      expect(source).not.toMatch(/IN\s*\(\s*'featured'\s*,\s*'p1'\s*\)/i);
      expect(source).not.toContain("tier = 'featured' OR tier = 'p1'");
    }
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
    expect(sourcePresets).toContain("SOURCE_PRESETS");
    expect(sourcePresets).toContain("DEFAULT_SOURCE_PRESET");
    expect(sourcePresets).toContain("SOURCE_PRESET_LABELS");
    expect(sourcePresets).toContain("sourcePresetToFeedFilter");

    for (const source of [homePage, allPage, homeFilters]) {
      expect(source).toContain("@/lib/feed/source-presets");
    }
    for (const source of [homePage, allPage]) {
      expect(source).toContain("coerceSourcePreset");
      expect(source).toContain("sourcePresetToFeedFilter");
      expect(source).not.toContain("function presetToFilter");
      expect(source).not.toContain("new Set<SourcePreset>");
      expect(source).not.toContain(
        "): { sourceGroup?: string; sourceKind?: string }",
      );
    }
    expect(homeFilters).toContain("SOURCE_PRESETS.map");
    expect(homeFilters).toContain("SOURCE_PRESET_LABELS");
    expect(homeFilters).not.toContain("const SOURCE_OPTS");
  });

  test("home filter tier and view controls derive from shared contracts", () => {
    expect(homeFilterContracts).toContain("HIGHLIGHT_ITEM_TIERS");
    expect(homeFilterContracts).toContain("HOME_TIERS");
    expect(homeFilterContracts).toContain("DEFAULT_HOME_TIER");
    expect(homeFilterContracts).toContain("const HOME_VIEWS");
    expect(homeFilterContracts).not.toContain("export const HOME_VIEWS");
    expect(homeFilterContracts).toContain("DEFAULT_HOME_VIEW");
    expect(homeFilterContracts).toContain("coerceHomeTier");
    expect(homeFilterContracts).toContain("coerceHomeView");

    expect(homeFilters).toContain("@/lib/feed/home-filters");
    expect(homeFilters).toContain("HOME_TIERS.map");
    expect(homeFilters).toContain("DEFAULT_HOME_TIER");
    expect(homeFilters).toContain("DEFAULT_HOME_VIEW");
    expect(homeFilters).not.toContain('export type HomeTier = "featured" | "p1"');
    expect(homeFilters).not.toContain('{ v: "featured", en: "featured", zh: "精选" }');
    expect(homeFilters).not.toContain('{ v: "p1",       en: "P1",       zh: "P1" }');
    expect(homePage).toContain("coerceHomeTier");
    expect(homePage).toContain("coerceHomeView");
    expect(homePage).toContain("DEFAULT_HOME_TIER");
    expect(homePage).not.toContain("function coerceTier");
    expect(homePage).not.toContain("function coerceView");
    expect(allPage).toContain("DEFAULT_HOME_TIER");
  });

  test("podcast tier controls derive from shared contracts", () => {
    expect(podcastsPage).toContain("@/lib/feed/podcast-filters");
    expect(podcastsPage).toContain("coercePodcastTier");
    expect(podcastsPage).toContain("DEFAULT_PODCAST_TIER");
    expect(podcastsPage).toContain("PODCAST_TIERS.map");
    expect(podcastsPage).not.toContain('type PodTier = "featured" | "all"');
    expect(podcastsPage).not.toContain('sp.tier === "all" ? "all" : "featured"');
  });

  test("source catalog view controls derive from shared contracts", () => {
    expect(sourcesPage).toContain("@/lib/sources/view");
    expect(sourcesPage).toContain("coerceSourcesView");
    expect(sourcesPage).not.toContain('sp.view === "cards" ? "cards" : "table"');

    expect(sourcesViewToggle).toContain("@/lib/sources/view");
    expect(sourcesViewToggle).toContain("SOURCES_VIEWS.map");
    expect(sourcesViewToggle).toContain("DEFAULT_SOURCES_VIEW");
    expect(sourcesViewToggle).not.toContain('export type SourcesView = "table" | "cards"');
    expect(sourcesViewToggle).not.toContain('href={`${pathname}?view=cards`}');
  });

  test("internal feed and commentary contracts use shared tier types", () => {
    expect(liveItems).toContain("VisibleItemTier");
    expect(liveItems).toContain("FeedView");
    expect(enrichPrompt).toContain("z.enum(ITEM_TIERS)");
    expect(itemCommentary).toContain("VISIBLE_ITEM_TIERS");
    expect(eventCommentary).toContain("VISIBLE_ITEM_TIERS");
  });

  test("worker queue and priority SQL reuse visible tier tuples", () => {
    for (const source of [systemStats, enrichWorker]) {
      expect(source).toContain("VISIBLE_ITEM_TIERS");
      expect(source).not.toContain("IN ('featured','p1','all')");
      expect(source).not.toContain("in ('featured','p1','all')");
    }
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
