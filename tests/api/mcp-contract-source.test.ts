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

describe("MCP contract source wiring", () => {
  test("feed/search item payloads use the shared v1 agent serializer", () => {
    expect(mcpRoute).toContain(
      'import { toAgentApiItem } from "@/lib/api/v1-items";',
    );
    expect(feedTool).toContain(
      "items: stories.map((s) => toAgentApiItem(s, locale))",
    );
    expect(searchTool).toContain(
      "items: stories.map((s) => toAgentApiItem(s, locale))",
    );
    expect(searchTool).toContain("...toAgentApiItem(s, locale)");
  });

  test("does not hand-roll event-aware feed/search item fields", () => {
    const feedSearchTools = `${feedTool}\n${searchTool}`;
    expect(feedSearchTools).not.toContain("has_commentary: Boolean");
    expect(feedSearchTools).not.toContain("canonical_title: isEvent");
    expect(feedSearchTools).not.toContain("const isEvent = (s.coverage");
  });
});
