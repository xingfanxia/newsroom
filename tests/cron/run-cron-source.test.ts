import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const scriptPath = resolve(root, "scripts/ops/run-cron.ts");
const packagePath = resolve(root, "package.json");

const RUNNER_KINDS = [
  "hourly",
  "daily",
  "weekly",
  "normalize",
  "enrich",
  "body",
  "yt",
  "cluster",
] as const;

describe("local cron runner source wiring", () => {
  const src = readFileSync(scriptPath, "utf8");

  it("keeps supported buckets in one dispatch table", () => {
    expect(src).toContain("type CronKind =");
    expect(src).toContain("const CRON_RUNNERS");
    expect(src).toContain("satisfies Record<CronKind, CronRunner>");
    expect(src).toContain('Object.keys(CRON_RUNNERS).join("|")');
    expect(src).not.toContain('if (kind === "hourly")');
    expect(src).not.toContain('if (kind === "cluster")');
  });

  it("exposes every local runner bucket through package scripts", () => {
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as {
      scripts: Record<string, string>;
    };

    for (const kind of RUNNER_KINDS) {
      expect(pkg.scripts[`cron:${kind}`]).toBe(
        `bun scripts/ops/run-cron.ts ${kind}`,
      );
    }
  });
});
