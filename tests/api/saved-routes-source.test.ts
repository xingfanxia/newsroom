import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const savedRoutes = read("lib/api/saved-routes.ts");
const v1SavedRoute = read("app/api/v1/saved/route.ts");
const mcpRoute = read("app/api/mcp/route.ts");

describe("saved route mutation helper source wiring", () => {
  test("shared helper owns saved list lookup and agent serialization semantics", () => {
    expect(savedRoutes).toContain("listSavedItemsRoutePayload");
    expect(savedRoutes).toContain("getSavedStories");
    expect(savedRoutes).toContain("toSavedAgentApiItem");
    expect(v1SavedRoute).toContain("listSavedItemsRoutePayload");
    expect(v1SavedRoute).not.toContain("@/lib/items/saved");
    expect(v1SavedRoute).not.toContain("@/lib/api/v1-items");
    expect(v1SavedRoute).not.toContain("getSavedStories");
    expect(v1SavedRoute).not.toContain("toSavedAgentApiItem");
  });

  test("shared helper owns saved move semantics for the browser move route", () => {
    const moveRoute = read("app/api/feedback/move/route.ts");

    expect(savedRoutes).toContain("moveSavedItemRoutePayload");
    expect(savedRoutes).toContain("upsertAppUser");
    expect(savedRoutes).toContain("moveItemToCollection");
    expect(moveRoute).toContain("moveSavedItemRoutePayload");
    expect(moveRoute).not.toContain("upsertAppUser");
    expect(moveRoute).not.toContain("moveItemToCollection");
    expect(moveRoute).not.toContain("@/lib/items/collections");
  });

  test("shared helper owns save toggle, item-not-found, and collection assignment semantics", () => {
    expect(savedRoutes).toContain("applyFeedbackToggle");
    expect(savedRoutes).toContain("FEEDBACK_SAVE_VOTE");
    expect(savedRoutes).toContain("userOwnsSavedCollection");
    expect(savedRoutes).toContain("assignSavedItemCollection");
    expect(savedRoutes).toContain("getSavedItemCollectionId");
    expect(savedRoutes).toContain("item_not_found");
    expect(savedRoutes).toContain("foreign key|not present");
  });

  test("v1 saved route and MCP save tool delegate mutation semantics to the helper", () => {
    for (const source of [v1SavedRoute, mcpRoute]) {
      expect(source).toContain("@/lib/api/saved-routes");
      expect(source).toContain("saveItemRoutePayload");
      expect(source).not.toContain("applyFeedbackToggle");
      expect(source).not.toContain("assignSavedItemCollection");
      expect(source).not.toContain("getSavedItemCollectionId");
      expect(source).not.toContain("userOwnsSavedCollection");
      expect(source).not.toContain("FEEDBACK_SAVE_VOTE");
      expect(source).not.toContain('vote: "save"');
    }
  });
});
