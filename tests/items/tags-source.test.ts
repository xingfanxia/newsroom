import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const mapperPaths = [
  "lib/items/live.ts",
  "lib/items/saved.ts",
  "lib/items/detail.ts",
  "lib/items/semantic-search.ts",
] as const;
const storyMapper = "lib/items/story-mapper.ts";

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("item tag mapper source wiring", () => {
  test("story mappers share item tag flattening", () => {
    const shared = read(storyMapper);
    expect(shared).toContain("@/lib/items/tags");
    expect(shared).toContain("flattenItemTags(");

    for (const path of mapperPaths) {
      const source = read(path);
      expect(source).toContain("@/lib/items/story-mapper");
      expect(source).not.toContain("@/lib/items/tags");
      expect(source).not.toContain("flattenItemTags(");
      expect(source).not.toContain("const tagBag =");
      expect(source).not.toContain("const flatTags = [");
      expect(source).not.toContain("capabilities?: string[]");
    }
  });
});
