import { describe, expect, it } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const scriptPath = "scripts/ops/run-cron.ts";
const packagePath = "package.json";
const vercelPath = "vercel.json";

function productionCronSlugs(): string[] {
  const vercel = JSON.parse(readSource(vercelPath)) as {
    crons: Array<{ path: string }>;
  };
  return vercel.crons.map((cron) => cron.path.replace(/^\/api\/cron\//, ""));
}

describe("local cron runner source wiring", () => {
  const src = readSource(scriptPath);

  it("keeps supported buckets in one dispatch table", () => {
    expect(src).toContain("type CronKind = keyof typeof CRON_RUNNERS");
    expect(src).toContain("const CRON_RUNNERS");
    expect(src).toContain("satisfies Record<string, CronRunner>");
    expect(src).toContain('USAGE_KINDS.join("|")');
    expect(src).not.toContain('| "hourly"');
    expect(src).not.toContain('if (kind === "hourly")');
    expect(src).not.toContain('if (kind === "cluster")');
  });

  it("covers every production cron route with a direct local runner", () => {
    for (const slug of productionCronSlugs()) {
      expect(src).toContain(`"${slug}":`);
    }
  });

  it("exposes every production cron route through package scripts", () => {
    const pkg = JSON.parse(readSource(packagePath)) as {
      scripts: Record<string, string>;
    };

    for (const slug of productionCronSlugs()) {
      expect(pkg.scripts[`cron:${slug}`]).toBe(
        `bun scripts/ops/run-cron.ts ${slug}`,
      );
    }
  });

  it("keeps legacy short aliases available for operator muscle memory", () => {
    const pkg = JSON.parse(readSource(packagePath)) as {
      scripts: Record<string, string>;
    };

    expect(src).toContain("CRON_ALIASES");
    expect(pkg.scripts["cron:hourly"]).toBe("bun scripts/ops/run-cron.ts hourly");
    expect(pkg.scripts["cron:daily"]).toBe("bun scripts/ops/run-cron.ts daily");
    expect(pkg.scripts["cron:weekly"]).toBe("bun scripts/ops/run-cron.ts weekly");
    expect(pkg.scripts["cron:body"]).toBe("bun scripts/ops/run-cron.ts body");
    expect(pkg.scripts["cron:score"]).toBe("bun scripts/ops/run-cron.ts score");
    expect(pkg.scripts["cron:yt"]).toBe("bun scripts/ops/run-cron.ts yt");
  });
});
