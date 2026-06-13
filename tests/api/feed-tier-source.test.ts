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
  test("item tiers and feed views have one runtime source of truth", () => {
    expect(types).toContain("export const ITEM_TIERS");
    expect(types).toContain("export const VISIBLE_ITEM_TIERS");
    expect(types).toContain("export const FEED_VIEWS");
  });

  test("feed-facing schemas use shared visible tiers and views", () => {
    for (const source of [feedParams, mcpRoute]) {
      expect(source).toContain("VISIBLE_ITEM_TIERS");
      expect(source).toContain("FEED_VIEWS");
      expect(source).toContain("z.enum(VISIBLE_ITEM_TIERS)");
      expect(source).toContain("z.enum(FEED_VIEWS)");
      expect(source).not.toContain('z.enum(["featured", "p1", "all"])');
      expect(source).not.toContain('z.enum(["today", "archive"])');
    }
  });

  test("internal feed and commentary contracts use shared tier types", () => {
    expect(liveItems).toContain("VisibleItemTier");
    expect(liveItems).toContain("FeedView");
    expect(enrichPrompt).toContain("z.enum(ITEM_TIERS)");
    expect(itemCommentary).toContain("VISIBLE_ITEM_TIERS");
    expect(eventCommentary).toContain("VISIBLE_ITEM_TIERS");
  });
});
