import { describe, expect, test } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const savedRoute = readSource("app/api/v1/saved/route.ts");
const savedRequests = readSource("lib/api/saved-requests.ts");
const savedQueryDefaults = readSource("lib/saved/query-defaults.ts");

describe("/api/v1/saved source wiring", () => {
  test("saved query defaults have one source of truth", () => {
    expect(savedQueryDefaults).toContain("SAVED_ITEMS_LIMIT_MIN");
    expect(savedQueryDefaults).toContain("SAVED_ITEMS_LIMIT_MAX");
    expect(savedQueryDefaults).toContain("DEFAULT_SAVED_ITEMS_LIMIT");
    expect(savedQueryDefaults).toContain("DEFAULT_SAVED_ITEMS_LOCALE");

    expect(savedRequests).toContain("@/lib/saved/query-defaults");
    expect(savedRequests).toContain(".min(SAVED_ITEMS_LIMIT_MIN)");
    expect(savedRequests).toContain(".max(SAVED_ITEMS_LIMIT_MAX)");
    expect(savedRequests).toContain(".default(DEFAULT_SAVED_ITEMS_LIMIT)");
    expect(savedRequests).toContain(".default(DEFAULT_SAVED_ITEMS_LOCALE)");
    expect(savedRequests).not.toContain(".min(1).max(200).optional().default(80)");
    expect(savedRequests).not.toContain('.default("en")');

    expect(savedRoute).toContain("query bounds live in");
    expect(savedRoute).not.toContain("limit      = 1..200, default 80");
    expect(savedRoute).not.toContain("locale     = zh | en (default en)");
  });

  test("route shares saved request schemas instead of declaring local zod objects", () => {
    expect(savedRoute).toContain("@/lib/api/saved-requests");
    expect(savedRoute).toContain("parseV1SavedQueryRequest");
    expect(savedRoute).toContain("v1SavedPostBodySchema");
    expect(savedRoute).not.toContain('from "zod"');
    expect(savedRoute).not.toContain("@/lib/api/query-params");
    expect(savedRoute).not.toContain("parseQueryParams(");
    expect(savedRoute).not.toContain("const getQuerySchema = z.object");
    expect(savedRoute).not.toContain("const postBodySchema = z.object");
  });

  test("list endpoint delegates saved lookup and agent serialization to the shared route helper", () => {
    expect(savedRoute).toContain("listSavedItemsRoutePayload");
    expect(savedRoute).not.toContain("@/lib/api/v1-items");
    expect(savedRoute).not.toContain("@/lib/items/saved");
    expect(savedRoute).not.toContain("toSavedAgentApiItem");
    expect(savedRoute).not.toContain("getSavedStories");
    expect(savedRoute).not.toContain("source_id: s.sourceId");
    expect(savedRoute).not.toContain("published_at: s.publishedAt");
  });

  test("write endpoint delegates save mutation semantics to the shared route helper", () => {
    expect(savedRoute).toContain("@/lib/api/saved-routes");
    expect(savedRoute).toContain("saveItemRoutePayload");
    expect(savedRoute).not.toContain("FEEDBACK_SAVE_VOTE");
    expect(savedRoute).not.toContain("assignSavedItemCollection");
    expect(savedRoute).not.toContain("getSavedItemCollectionId");
    expect(savedRoute).not.toContain("userOwnsSavedCollection");
    expect(savedRoute).not.toContain('vote: "save"');
    expect(savedRoute).not.toContain(".update(feedback)");
    expect(savedRoute).not.toContain("void sql");
  });
});
