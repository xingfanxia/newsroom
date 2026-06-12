import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const helperPath = resolve(root, "app/api/cron/_fetch-bucket-route.ts");

function routeSource(name: "fetch-hourly" | "fetch-daily" | "fetch-weekly") {
  return readFileSync(resolve(root, `app/api/cron/${name}/route.ts`), "utf8");
}

describe("fetch cron routes", () => {
  it("centralizes auth, fetch, normalize, and JSON response wiring", () => {
    expect(existsSync(helperPath)).toBe(true);
    const helper = readFileSync(helperPath, "utf8");

    expect(helper).toContain("runFetchBucket");
    expect(helper).toContain("runNormalizer");
    expect(helper).toContain("verifyCron");
    expect(helper).toContain("NextResponse.json");
    expect(helper).toContain("fetch: fetchReport");
    expect(helper).toContain("normalize: normalizeReport");
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
});
