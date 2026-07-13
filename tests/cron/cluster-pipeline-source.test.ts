import { describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import { readSource, sourcePath } from "@/tests/helpers/source";

const pipelinePath = "workers/cluster/pipeline.ts";
const routePath = "app/api/cron/cluster/route.ts";
const scriptPath = "scripts/ops/run-cron.ts";

describe("cluster cron pipeline wiring", () => {
  it("centralizes the full Stage A/A.5/B/B+/C/D sequence in a worker helper", () => {
    expect(existsSync(sourcePath(pipelinePath))).toBe(true);
    const src = readSource(pipelinePath);

    const stageOrder = [
      "runClusterBatch()",
      "runSingletonReclusterBatch(",
      "runArbitrationBatch()",
      "runMergeBatch(",
      "runCanonicalTitleBatch()",
      "runEventCommentaryBatch({",
    ].map((needle) => src.indexOf(needle));

    for (const idx of stageOrder) expect(idx).toBeGreaterThan(0);
    expect(stageOrder).toEqual([...stageOrder].sort((a, b) => a - b));
    expect(src).toContain("safeStage");
    expect(src).toContain("MERGE_RECENCY_HOURS = 24"); // W9: >= 8h cluster cadence
    // Stage A.5 recency is the imported candidate window (window + cooldown,
    // the W7 A2 recall guarantee), passed through to the recluster batch —
    // renamed from the old local SINGLETON_RECLUSTER_RECENCY_HOURS = 72.
    expect(src).toContain(
      "recencyHours: SINGLETON_RECLUSTER_CANDIDATE_RECENCY_HOURS",
    );
    expect(src).toContain("EVENT_COMMENTARY_CRON_RECENCY_HOURS");
    expect(src).toContain("runEventCommentaryBatch({");
    expect(src).toContain("recencyHours: EVENT_COMMENTARY_CRON_RECENCY_HOURS");
  });

  it("keeps the HTTP route as shared cron envelope plus response mapping", () => {
    const src = readSource(routePath);

    expect(src).toContain("runClusterPipeline");
    expect(src).toContain("runCronJsonRoute");
    expect(src).toContain("merge: report.merge");
    expect(src).not.toContain("verifyCron(");
    expect(src).not.toContain("NextResponse");
    expect(src).not.toContain("runClusterBatch()");
    expect(src).not.toContain("runArbitrationBatch()");
    expect(src).not.toContain("runCanonicalTitleBatch()");
    expect(src).not.toContain("runEventCommentaryBatch()");
  });

  it("keeps the local operator cluster command on the production pipeline", () => {
    const src = readSource(scriptPath);

    expect(src).toContain("runClusterPipeline");
    expect(src).toContain('"cluster": () => runClusterPipeline()');
    expect(src).not.toContain("runClusterBatch");
  });
});
