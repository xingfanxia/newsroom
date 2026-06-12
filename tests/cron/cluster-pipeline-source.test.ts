import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const pipelinePath = resolve(root, "workers/cluster/pipeline.ts");
const routePath = resolve(root, "app/api/cron/cluster/route.ts");
const scriptPath = resolve(root, "scripts/ops/run-cron.ts");

describe("cluster cron pipeline wiring", () => {
  it("centralizes the full Stage A/A.5/B/B+/C/D sequence in a worker helper", () => {
    expect(existsSync(pipelinePath)).toBe(true);
    const src = readFileSync(pipelinePath, "utf8");

    const stageOrder = [
      "runClusterBatch()",
      "runSingletonReclusterBatch(",
      "runArbitrationBatch()",
      "runMergeBatch(",
      "runCanonicalTitleBatch()",
      "runEventCommentaryBatch()",
    ].map((needle) => src.indexOf(needle));

    for (const idx of stageOrder) expect(idx).toBeGreaterThan(0);
    expect(stageOrder).toEqual([...stageOrder].sort((a, b) => a - b));
    expect(src).toContain("safeStage");
    expect(src).toContain("MERGE_RECENCY_HOURS = 6");
    expect(src).toContain("SINGLETON_RECLUSTER_RECENCY_HOURS = 72");
  });

  it("keeps the HTTP route as auth plus response wiring", () => {
    const src = readFileSync(routePath, "utf8");

    expect(src).toContain("runClusterPipeline");
    expect(src).toContain("verifyCron");
    expect(src).toContain("NextResponse.json");
    expect(src).toContain("merge: report.merge");
    expect(src).not.toContain("runClusterBatch()");
    expect(src).not.toContain("runArbitrationBatch()");
    expect(src).not.toContain("runCanonicalTitleBatch()");
    expect(src).not.toContain("runEventCommentaryBatch()");
  });

  it("keeps the local operator cluster command on the production pipeline", () => {
    const src = readFileSync(scriptPath, "utf8");

    expect(src).toContain("runClusterPipeline");
    expect(src).toContain("if (kind === \"cluster\")");
    expect(src).not.toContain("runClusterBatch");
  });
});
