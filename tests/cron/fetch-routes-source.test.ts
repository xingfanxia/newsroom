import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { readSource, sourcePath } from "@/tests/helpers/source";

const routeHelperPath = "app/api/cron/_fetch-bucket-route.ts";
const envelopeHelperPath = "app/api/cron/_route.ts";
const workerHelperPath = "workers/fetcher/pipeline.ts";
const scriptPath = "scripts/ops/run-cron.ts";

function routeSource(name: "fetch-hourly" | "fetch-daily" | "fetch-weekly") {
  return readSource(`app/api/cron/${name}/route.ts`);
}

describe("fetch cron routes", () => {
  it("centralizes fetch then normalize sequencing in a worker helper", () => {
    expect(existsSync(sourcePath(workerHelperPath))).toBe(true);
    const helper = readSource(workerHelperPath);

    expect(helper).toContain("runFetchAndNormalize");
    expect(helper).toContain("runFetchBucket");
    expect(helper).toContain("runNormalizer");
    expect(helper).toContain("return { fetch, normalize }");
  });

  it("centralizes auth and JSON response wiring in the shared cron route helper", () => {
    expect(existsSync(sourcePath(envelopeHelperPath))).toBe(true);
    const helper = readSource(envelopeHelperPath);

    expect(helper).toContain("runCronJsonRoute");
    expect(helper).toContain("verifyCron");
    expect(helper).toContain("NextResponse.json");
    expect(helper).toContain("at: new Date().toISOString()");
  });

  it("keeps the fetch HTTP helper focused on payload mapping", () => {
    expect(existsSync(sourcePath(routeHelperPath))).toBe(true);
    const helper = readSource(routeHelperPath);

    expect(helper).toContain("runFetchAndNormalize");
    expect(helper).toContain("runCronJsonRoute");
    expect(helper).toContain("fetch: report.fetch");
    expect(helper).toContain("normalize: report.normalize");
    expect(helper).not.toContain("runFetchBucket(");
    expect(helper).not.toContain("runNormalizer(");
    expect(helper).not.toContain("verifyCron(");
    expect(helper).not.toContain("NextResponse");
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
    const src = readSource(scriptPath);

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
