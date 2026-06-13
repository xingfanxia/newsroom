import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const savedRoute = readFileSync(
  resolve(root, "app/api/v1/saved/route.ts"),
  "utf8",
);

describe("/api/v1/saved source wiring", () => {
  test("route shares saved request schemas instead of declaring local zod objects", () => {
    expect(savedRoute).toContain("@/lib/api/saved-requests");
    expect(savedRoute).toContain("v1SavedQuerySchema");
    expect(savedRoute).toContain("v1SavedPostBodySchema");
    expect(savedRoute).not.toContain('from "zod"');
    expect(savedRoute).not.toContain("const getQuerySchema = z.object");
    expect(savedRoute).not.toContain("const postBodySchema = z.object");
  });

  test("list endpoint uses the shared saved agent serializer", () => {
    expect(savedRoute).toContain(
      'import { toSavedAgentApiItem } from "@/lib/api/v1-items";',
    );
    expect(savedRoute).toContain(
      "items: stories.map((s) => toSavedAgentApiItem(s, q.locale))",
    );
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
