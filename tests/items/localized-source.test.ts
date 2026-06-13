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

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("localized item mapper source wiring", () => {
  test("story mappers share locale fallback helpers", () => {
    for (const path of mapperPaths) {
      const source = read(path);
      expect(source).toContain("@/lib/items/localized");
      expect(source).toContain("pickLocalizedText");
      expect(source).not.toContain("summaryEn ?? r.summaryZh");
      expect(source).not.toContain("summaryZh ?? r.summaryEn");
      expect(source).not.toContain("reasoningEn ?? r.reasoningZh");
      expect(source).not.toContain("reasoningZh ?? r.reasoningEn");
    }
  });
});
