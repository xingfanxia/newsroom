import { describe, expect, it } from "bun:test";
import { readSource } from "@/tests/helpers/source";

describe("runEnrichBatch backfill options", () => {
  const worker = readSource("workers/enrich/index.ts");
  const route = readSource("app/api/cron/enrich/route.ts");

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
