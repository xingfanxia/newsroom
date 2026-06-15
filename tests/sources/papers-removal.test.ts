import { describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import { sourceCatalog } from "@/lib/sources/catalog";
import { readSource, sourcePath } from "@/tests/helpers/source";

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
    expect(existsSync(sourcePath("app/[locale]/papers/page.tsx"))).toBe(false);

    const navSrc = readSource("lib/shell/nav-data.ts");
    expect(navSrc).not.toContain('id: "papers"');
    expect(navSrc).not.toContain('href: "/papers"');

    const sitemapSrc = readSource("app/sitemap.ts");
    expect(sitemapSrc).not.toContain('"/papers"');
  });

  it("does not expose papers as RSS, MCP, or public skill routing", () => {
    const rssSrc = readSource("app/api/rss/[slug]/route.ts");
    expect(rssSrc).not.toContain("papers:");
    expect(rssSrc).not.toContain('"papers"');

    const mcpSrc = readSource("app/api/mcp/route.ts");
    expect(mcpSrc).not.toContain("ax-radar://papers");

    const skillSrc = readSource("app/skill.md/route.ts");
    expect(skillSrc).not.toContain("include_source_tags=arxiv,paper");
    expect(skillSrc).not.toContain("latest AI papers");
  });
});
