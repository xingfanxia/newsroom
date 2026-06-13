import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const routeHelperPath = resolve(root, "app/api/cron/_fetch-bucket-route.ts");
const workerHelperPath = resolve(root, "workers/fetcher/pipeline.ts");
const scriptPath = resolve(root, "scripts/ops/run-cron.ts");

function routeSource(name: "fetch-hourly" | "fetch-daily" | "fetch-weekly") {
  return readFileSync(resolve(root, `app/api/cron/${name}/route.ts`), "utf8");
}

describe("fetch cron routes", () => {
  it("centralizes fetch then normalize sequencing in a worker helper", () => {
    expect(existsSync(workerHelperPath)).toBe(true);
    const helper = readFileSync(workerHelperPath, "utf8");

    expect(helper).toContain("runFetchAndNormalize");
    expect(helper).toContain("runFetchBucket");
    expect(helper).toContain("runNormalizer");
    expect(helper).toContain("return { fetch, normalize }");
  });

  it("centralizes auth and JSON response wiring in the HTTP route helper", () => {
    expect(existsSync(routeHelperPath)).toBe(true);
    const helper = readFileSync(routeHelperPath, "utf8");

    expect(helper).toContain("runFetchAndNormalize");
    expect(helper).toContain("verifyCron");
    expect(helper).toContain("NextResponse.json");
    expect(helper).toContain("fetch: report.fetch");
    expect(helper).toContain("normalize: report.normalize");
    expect(helper).not.toContain("runFetchBucket(");
    expect(helper).not.toContain("runNormalizer(");
  });

  it("keeps leaf routes limited to their public kind and source cadences", () => {
    const routes = [
      {
        name: "fetch-hourly" as const,
        cadenceSnippet: 'cadences: ["live", "hourly"]',
      },
      { name: "fetch-daily" as const, cadenceSnippet: 'cadences: ["daily"]' },
      { name: "fetch-weekly" as const, cadenceSnippet: 'cadences: ["weekly"]' },
    ];

    for (const route of routes) {
      const src = routeSource(route.name);
      expect(src).toContain("runFetchBucketCronRoute");
      expect(src).toContain(`kind: "${route.name}"`);
      expect(src).toContain(route.cadenceSnippet);
      expect(src).toMatch(/maxDuration\s*=\s*800/);
      expect(src).toContain('dynamic = "force-dynamic"');
      expect(src).toContain('runtime = "nodejs"');

      expect(src).not.toContain("runFetchBucket(");
      expect(src).not.toContain("runNormalizer(");
      expect(src).not.toContain("verifyCron(");
      expect(src).not.toContain("NextResponse.json");
    }
  });

  it("keeps local operator cron buckets on the same fetch+normalize helper", () => {
    const src = readFileSync(scriptPath, "utf8");

    expect(src).toContain("runFetchAndNormalize");
    expect(src).toContain('runFetchAndNormalize(["live", "hourly"])');
    expect(src).toContain('runFetchAndNormalize(["daily"])');
    expect(src).toContain('runFetchAndNormalize(["weekly"])');
    expect(src).not.toContain("runFetchBucket");
    expect(src).toContain('"fetch-hourly": fetchHourly');
    expect(src).toContain('"fetch-daily": fetchDaily');
    expect(src).toContain('"fetch-weekly": fetchWeekly');
    expect(src).toContain("hourly: \"fetch-hourly\"");
    expect(src).toContain('USAGE_KINDS.join("|")');
  });
});
