import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const cleanupPath = resolve(root, "scripts/ops/cleanup-paper-sources.ts");

describe("paper source cleanup script", () => {
  it("exists and defaults to dry-run", () => {
    expect(existsSync(cleanupPath)).toBe(true);
    const src = readFileSync(cleanupPath, "utf8");
    expect(src).toContain("dryRun: true");
    expect(src).toContain("--apply");
  });

  it("targets only explicit paper sources and never uses table-wide destructive SQL", () => {
    const src = readFileSync(cleanupPath, "utf8");
    expect(src).toContain("PAPER_SOURCE_IDS");
    expect(src).toContain("arxiv-cs-ai");
    expect(src).toContain("hf-papers-takara");
    expect(src).not.toMatch(/\bTRUNCATE\b/i);
    expect(src).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(src).not.toMatch(/\bDROP\s+DATABASE\b/i);
  });

  it("also removes paper-category items from mixed sources like AI HOT", () => {
    const src = readFileSync(cleanupPath, "utf8");
    expect(src).toContain("MIXED_PAPER_SOURCE_IDS");
    expect(src).toContain("aihot-selected");
    expect(src).toContain("raw_payload->>'category' = 'paper'");
    expect(src).toContain("cleanup_paper_raw_items");
  });

  it("repairs affected clusters after deleting paper items", () => {
    const src = readFileSync(cleanupPath, "utf8");
    expect(src).toContain("affected_clusters");
    expect(src).toContain("DELETE FROM raw_items");
    expect(src).toContain("DELETE FROM clusters");
    expect(src).toContain("UPDATE clusters");
    expect(src).toContain("member_count");
    expect(src).toContain("lead_item_id");
  });
});
