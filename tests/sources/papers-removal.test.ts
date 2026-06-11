import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { sourceCatalog } from "@/lib/sources/catalog";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

const PAPER_SOURCE_IDS = [
  "arxiv-cs-ai",
  "arxiv-cs-cl",
  "arxiv-cs-lg",
  "huggingface-papers",
  "paperswithcode",
  "hf-papers-takara",
];

describe("paper sources are removed from the product", () => {
  it("catalog no longer contains arxiv/paper feed sources", () => {
    const ids = new Set(sourceCatalog.map((s) => s.id));
    for (const id of PAPER_SOURCE_IDS) {
      expect(ids.has(id)).toBe(false);
    }

    const paperTagged = sourceCatalog.filter((s) =>
      s.tags.some((tag) => tag === "arxiv" || tag === "paper"),
    );
    expect(paperTagged).toEqual([]);
  });

  it("does not expose a papers route or nav item", () => {
    expect(existsSync(resolve(root, "app/[locale]/papers/page.tsx"))).toBe(
      false,
    );

    const navSrc = readFileSync(resolve(root, "lib/shell/nav-data.ts"), "utf8");
    expect(navSrc).not.toContain('id: "papers"');
    expect(navSrc).not.toContain('href: "/papers"');

    const sitemapSrc = readFileSync(resolve(root, "app/sitemap.ts"), "utf8");
    expect(sitemapSrc).not.toContain('"/papers"');
  });

  it("does not expose papers as RSS, MCP, or public skill routing", () => {
    const rssSrc = readFileSync(
      resolve(root, "app/api/rss/[slug]/route.ts"),
      "utf8",
    );
    expect(rssSrc).not.toContain("papers:");
    expect(rssSrc).not.toContain('"papers"');

    const mcpSrc = readFileSync(resolve(root, "app/api/mcp/route.ts"), "utf8");
    expect(mcpSrc).not.toContain("ax-radar://papers");

    const skillSrc = readFileSync(
      resolve(root, "app/skill.md/route.ts"),
      "utf8",
    );
    expect(skillSrc).not.toContain("include_source_tags=arxiv,paper");
    expect(skillSrc).not.toContain("latest AI papers");
  });
});
