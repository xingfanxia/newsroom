import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const mcpRoute = readFileSync(resolve(root, "app/api/mcp/route.ts"), "utf8");

function sectionBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

const feedTool = sectionBetween(
  mcpRoute,
  'server.registerTool(\n    "ax_radar_feed"',
  'server.registerTool(\n    "ax_radar_event_members"',
);
const searchTool = sectionBetween(
  mcpRoute,
  'server.registerTool(\n    "ax_radar_search"',
  'server.registerTool(\n    "ax_radar_sources"',
);
const sourcesTool = sectionBetween(
  mcpRoute,
  'server.registerTool(\n    "ax_radar_sources"',
  'server.registerTool(\n    "ax_radar_save"',
);
const saveTool = sectionBetween(
  mcpRoute,
  'server.registerTool(\n    "ax_radar_save"',
  'server.registerTool(\n    "ax_radar_collections_list"',
);

describe("MCP contract source wiring", () => {
  test("feed/search item payloads use the shared v1 agent serializer", () => {
    expect(mcpRoute).toContain(
      'import { toAgentApiItem } from "@/lib/api/v1-items";',
    );
    expect(feedTool).toContain("toAgentApiItem(s, locale)");
    expect(searchTool).toContain("toAgentApiItem(s, locale)");
    expect(searchTool).toContain("...toAgentApiItem(s, locale)");
  });

  test("feed/search tools share execution with the REST surfaces", () => {
    expect(mcpRoute).toContain('from "@/lib/api/feed-results"');
    expect(mcpRoute).toContain('from "@/lib/api/search-results"');
    expect(feedTool).toContain("runFeedQuery");
    expect(searchTool).toContain("runSearchQuery");
    expect(feedTool).not.toContain("countFeaturedStories");
    expect(feedTool).not.toContain("getFeaturedStories");
    expect(searchTool).not.toContain("semanticSearch");
    expect(searchTool).not.toContain("getFeaturedStories");
    expect(searchTool).not.toContain("total: stories.length");
    expect(mcpRoute).not.toContain('import { semanticSearch }');
  });

  test("does not hand-roll event-aware feed/search item fields", () => {
    const feedSearchTools = `${feedTool}\n${searchTool}`;
    expect(feedSearchTools).not.toContain("has_commentary: Boolean");
    expect(feedSearchTools).not.toContain("canonical_title: isEvent");
    expect(feedSearchTools).not.toContain("const isEvent = (s.coverage");
  });

  test("save tool uses the shared owner-aware collection assignment helper", () => {
    expect(mcpRoute).toContain("assignSavedItemCollection");
    expect(mcpRoute).toContain("getSavedItemCollectionId");
    expect(mcpRoute).toContain("userOwnsSavedCollection");
    expect(saveTool).toContain("assignSavedItemCollection");
    expect(saveTool).toContain("getSavedItemCollectionId");
    expect(saveTool).toContain("userOwnsSavedCollection");
    expect(saveTool).not.toContain(".update(feedback)");
    expect(saveTool).not.toContain("collection_id ?? null");
  });

  test("sources tool uses the shared source catalog serializer", () => {
    expect(mcpRoute).toContain("toMcpSourceApiItem");
    expect(sourcesTool).toContain('listSourceCatalogRows("id")');
    expect(sourcesTool).toContain("rows.map(toMcpSourceApiItem)");
    expect(sourcesTool).toContain("Return the monitored source catalog");
    expect(sourcesTool).not.toContain("52-source catalog");
    expect(sourcesTool).not.toContain("59-source catalog");
    expect(sourcesTool).not.toContain("sourceHealth.");
    expect(sourcesTool).not.toContain(".select({");
  });
});
