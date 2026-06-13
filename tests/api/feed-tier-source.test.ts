import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const types = readFileSync(resolve(root, "lib/types.ts"), "utf8");
const feedParams = readFileSync(
  resolve(root, "lib/api/feed-query-params.ts"),
  "utf8",
);
const mcpRoute = readFileSync(resolve(root, "app/api/mcp/route.ts"), "utf8");
const sourcePresets = readFileSync(
  resolve(root, "app/[locale]/_source-presets.ts"),
  "utf8",
);
const storyItemFields = readFileSync(
  resolve(root, "lib/api/story-item-fields.ts"),
  "utf8",
);
const leadPick = readFileSync(
  resolve(root, "workers/cluster/lead-pick.ts"),
  "utf8",
);
const recomputeClusterLeads = readFileSync(
  resolve(root, "scripts/migrations/recompute-cluster-leads.ts"),
  "utf8",
);
const homePage = readFileSync(resolve(root, "app/[locale]/page.tsx"), "utf8");
const allPage = readFileSync(
  resolve(root, "app/[locale]/all/page.tsx"),
  "utf8",
);
const liveItems = readFileSync(resolve(root, "lib/items/live.ts"), "utf8");
const enrichPrompt = readFileSync(resolve(root, "workers/enrich/prompt.ts"), "utf8");
const itemCommentary = readFileSync(
  resolve(root, "workers/enrich/commentary.ts"),
  "utf8",
);
const eventCommentary = readFileSync(
  resolve(root, "workers/cluster/commentary.ts"),
  "utf8",
);

describe("feed tier/view source wiring", () => {
  test("feed-facing filter enums have one runtime source of truth", () => {
    expect(types).toContain("export const ITEM_TIERS");
    expect(types).toContain("export const VISIBLE_ITEM_TIERS");
    expect(types).toContain("export const FEED_VIEWS");
    expect(types).toContain("export const SOURCE_GROUPS");
    expect(types).toContain("export const SOURCE_KINDS");
  });

  test("feed-facing schemas use shared visible tiers, views, and source filters", () => {
    for (const source of [feedParams, mcpRoute]) {
      expect(source).toContain("VISIBLE_ITEM_TIERS");
      expect(source).toContain("FEED_VIEWS");
      expect(source).toContain("SOURCE_GROUPS");
      expect(source).toContain("SOURCE_KINDS");
      expect(source).toContain("z.enum(VISIBLE_ITEM_TIERS)");
      expect(source).toContain("z.enum(FEED_VIEWS)");
      expect(source).toContain("z.enum(SOURCE_GROUPS)");
      expect(source).toContain("z.enum(SOURCE_KINDS)");
      expect(source).not.toContain('z.enum(["featured", "p1", "all"])');
      expect(source).not.toContain('z.enum(["today", "archive"])');
      expect(source).not.toContain("source_group: z.string().min(1)");
      expect(source).not.toContain("source_kind: z.string().min(1)");
      expect(source).not.toContain("source_group: z.string().optional()");
      expect(source).not.toContain("source_kind: z.string().optional()");
    }
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
