import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { readSource, sourcePath } from "@/tests/helpers/source";

const helperPath = "app/api/cron/_route.ts";
const fetchBucketRoutePath = "app/api/cron/_fetch-bucket-route.ts";

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

function routeSource(
  name: (typeof cronJsonRouteFiles)[number] | (typeof fetchCronRouteFiles)[number],
): string {
  return readSource(`app/api/cron/${name}/route.ts`);
}

describe("cron route HTTP envelope helper", () => {
  it("centralizes cron auth, timestamp, and JSON response wiring", () => {
    expect(existsSync(sourcePath(helperPath))).toBe(true);
    const helper = readSource(helperPath);

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
    const src = readSource(fetchBucketRoutePath);

    expect(src).toContain("runCronJsonRoute");
    expect(src).toContain("runFetchAndNormalize");
    expect(src).toContain("fetch: report.fetch");
    expect(src).toContain("normalize: report.normalize");
    expect(src).not.toContain("NextResponse");
    expect(src).not.toContain("verifyCron(");
    expect(src).not.toContain("at: new Date().toISOString()");
  });
});
