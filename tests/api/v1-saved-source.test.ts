import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const savedRoute = readFileSync(
  resolve(root, "app/api/v1/saved/route.ts"),
  "utf8",
);

describe("/api/v1/saved source wiring", () => {
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

  test("write endpoint delegates collection assignment to owner-aware helpers", () => {
    expect(savedRoute).toContain("assignSavedItemCollection");
    expect(savedRoute).toContain("getSavedItemCollectionId");
    expect(savedRoute).toContain("userOwnsSavedCollection");
    expect(savedRoute).not.toContain(".update(feedback)");
    expect(savedRoute).not.toContain("void sql");
  });
});
