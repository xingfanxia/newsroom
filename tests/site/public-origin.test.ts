import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const publicSurfaceFiles = [
  "app/sitemap.ts",
  "app/robots.ts",
  "lib/rss/legacy-feeds.ts",
  "app/api/feed/[locale]/rss.xml/route.ts",
  "app/api/feed/newsletter/[locale]/rss.xml/route.ts",
  "app/openapi.yaml/route.ts",
  "app/skill.md/route.ts",
  "app/[locale]/agents/page.tsx",
  "app/[locale]/agents/_tabs.tsx",
] as const;

const runtimeSiteOriginConsumers = [
  ...publicSurfaceFiles,
  "lib/sources/aihot.ts",
] as const;

describe("public site origin contract", () => {
  test("site helper exposes one canonical public origin", async () => {
    const site = await import("@/lib/site");

    expect(site.PUBLIC_SITE_URL).toBe("https://news.ax0x.ai");
    expect(site.PUBLIC_SITE_HOST).toBe("news.ax0x.ai");
    expect(site.publicUrl()).toBe("https://news.ax0x.ai");
    expect(site.publicUrl("skill.md")).toBe("https://news.ax0x.ai/skill.md");
    expect(site.publicUrl("/skill.md")).toBe("https://news.ax0x.ai/skill.md");
    expect(site.publicUrl("/zh/agents")).toBe("https://news.ax0x.ai/zh/agents");
  });

  test("runtime site-origin consumers use the shared origin helper", () => {
    for (const file of runtimeSiteOriginConsumers) {
      const source = read(file);
      expect(source, file).toContain("@/lib/site");
      expect(source, file).not.toContain("https://news.ax0x.ai");
      expect(source, file).not.toContain("https://newsroom-orpin.vercel.app");
      expect(source, file).not.toContain("newsroom-orpin.vercel.app");
    }
  });

  test("current README names the canonical production URL", () => {
    const readme = read("README.md");
    const liveLine = readme
      .split("\n")
      .find((line) => line.startsWith("🌐 **Live**:"));

    expect(liveLine).toContain("https://news.ax0x.ai");
    expect(liveLine).not.toContain("newsroom-orpin.vercel.app");
  });
});
