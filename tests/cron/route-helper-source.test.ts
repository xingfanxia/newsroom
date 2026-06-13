import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const helperPath = resolve(root, "app/api/cron/_route.ts");
const fetchBucketRoutePath = resolve(root, "app/api/cron/_fetch-bucket-route.ts");

const cronJsonRouteFiles = [
  "article-body",
  "cluster",
  "commentary",
  "enrich",
  "newsletter-daily",
  "newsletter-monthly",
  "normalize",
  "score-backfill",
] as const;
const fetchCronRouteFiles = ["fetch-daily", "fetch-hourly", "fetch-weekly"] as const;

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function routeSource(
  name: (typeof cronJsonRouteFiles)[number] | (typeof fetchCronRouteFiles)[number],
): string {
  return read(`app/api/cron/${name}/route.ts`);
}

describe("cron route HTTP envelope helper", () => {
  it("centralizes cron auth, timestamp, and JSON response wiring", () => {
    expect(existsSync(helperPath)).toBe(true);
    const helper = readFileSync(helperPath, "utf8");

    expect(helper).toContain("runCronJsonRoute");
    expect(helper).toContain("verifyCron");
    expect(helper).toContain("NextResponse.json");
    expect(helper).toContain("at: new Date().toISOString()");
  });

  it("keeps every cron leaf route on the shared HTTP envelope helper", () => {
    for (const name of cronJsonRouteFiles) {
      const src = routeSource(name);

      expect(src, name).toContain("runCronJsonRoute");
      expect(src, name).toMatch(/maxDuration\s*=\s*800/);
      expect(src, name).toContain('dynamic = "force-dynamic"');
      expect(src, name).toContain('runtime = "nodejs"');

      expect(src, name).not.toContain("NextResponse");
      expect(src, name).not.toContain("verifyCron(");
      expect(src, name).not.toContain("at: new Date().toISOString()");
    }
  });

  it("keeps fetch leaf routes on their fetch bucket helper", () => {
    for (const name of fetchCronRouteFiles) {
      const src = routeSource(name);

      expect(src, name).toContain("runFetchBucketCronRoute");
      expect(src, name).toMatch(/maxDuration\s*=\s*800/);
      expect(src, name).toContain('dynamic = "force-dynamic"');
      expect(src, name).toContain('runtime = "nodejs"');

      expect(src, name).not.toContain("NextResponse");
      expect(src, name).not.toContain("verifyCron(");
      expect(src, name).not.toContain("at: new Date().toISOString()");
    }
  });

  it("keeps the fetch bucket helper focused on fetch/normalize payload mapping", () => {
    const src = readFileSync(fetchBucketRoutePath, "utf8");

    expect(src).toContain("runCronJsonRoute");
    expect(src).toContain("runFetchAndNormalize");
    expect(src).toContain("fetch: report.fetch");
    expect(src).toContain("normalize: report.normalize");
    expect(src).not.toContain("NextResponse");
    expect(src).not.toContain("verifyCron(");
    expect(src).not.toContain("at: new Date().toISOString()");
  });
});
