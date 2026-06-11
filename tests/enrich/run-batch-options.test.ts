import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

describe("runEnrichBatch backfill options", () => {
  const worker = readFileSync(resolve(root, "workers/enrich/index.ts"), "utf8");
  const route = readFileSync(
    resolve(root, "app/api/cron/enrich/route.ts"),
    "utf8",
  );

  it("supports optional publication-window filtering for targeted backfills", () => {
    expect(worker).toContain("export type EnrichBatchOptions");
    expect(worker).toContain("windowStart?: Date");
    expect(worker).toContain("windowEnd?: Date");
    expect(worker).toContain("opts.windowStart.toISOString()");
    expect(worker).toContain("opts.windowEnd.toISOString()");
  });

  it("keeps cron on the default full-queue behavior", () => {
    expect(route).toContain("runEnrichBatch()");
    expect(route).not.toContain("windowStart");
    expect(route).not.toContain("windowEnd");
  });
});
