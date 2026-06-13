import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const storySelect = read("lib/items/story-select.ts");
const baseMapperPaths = [
  "lib/items/live.ts",
  "lib/items/saved.ts",
  "lib/items/detail.ts",
  "lib/items/semantic-search.ts",
] as const;
const eventMapperPaths = ["lib/items/live.ts", "lib/items/saved.ts"] as const;

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function storyQuerySource(path: string): string {
  const source = read(path);
  return path === "lib/items/live.ts"
    ? source.split("export async function getEventMembers")[0]!
    : source;
}

describe("story select source wiring", () => {
  test("shared story select fields own the DB column aliases", () => {
    expect(storySelect).toContain("export const storySelectFields");
    expect(storySelect).toContain("export const eventStorySelectFields");
    expect(storySelect).toContain("titleZh: items.titleZh");
    expect(storySelect).toContain("sourceNameZh: sources.nameZh");
    expect(storySelect).toContain("clusterCanonicalTitleZh");
  });

  test("story queries reuse shared select fields instead of repeating aliases", () => {
    for (const path of baseMapperPaths) {
      const source = storyQuerySource(path);
      expect(source).toContain("@/lib/items/story-select");
      expect(source).toContain("...storySelectFields");
      expect(source).not.toContain("titleZh: items.titleZh");
      expect(source).not.toContain("sourceNameZh: sources.nameZh");
    }

    for (const path of eventMapperPaths) {
      expect(read(path)).toContain("...eventStorySelectFields");
    }

    for (const path of ["lib/items/detail.ts", "lib/items/semantic-search.ts"]) {
      expect(read(path)).not.toContain("...eventStorySelectFields");
    }
  });
});
