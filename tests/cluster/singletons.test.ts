import { describe, expect, it } from "bun:test";
import {
  decideSingletonRecluster,
  resolveSingletonReclusterLimit,
  SINGLETON_RECLUSTER_SIMILARITY_THRESHOLD,
  SINGLETON_RECLUSTER_WINDOW_HOURS,
} from "@/workers/cluster/singletons";
import { readSource } from "@/tests/helpers/source";

const pipelineSrc = readSource("workers/cluster/pipeline.ts");
const singletonSrc = readSource("workers/cluster/singletons.ts");
const tierSqlSrc = readSource("lib/items/tier-sql.ts");

describe("singleton recluster decision", () => {
  it("moves a singleton into a different cluster when the nearest neighbor is within the Stage A threshold", () => {
    const decision = decideSingletonRecluster({
      currentClusterId: 100,
      nearest: { clusterId: 200, distance: 0.249 },
    });

    expect(decision).toEqual({ action: "move", targetClusterId: 200 });
  });

  it("keeps a singleton when the nearest neighbor is outside the Stage A threshold", () => {
    const decision = decideSingletonRecluster({
      currentClusterId: 100,
      nearest: { clusterId: 200, distance: 0.251 },
    });

    expect(decision).toEqual({ action: "keep", reason: "below-threshold" });
  });

  it("keeps a singleton when the nearest neighbor is already in the same cluster", () => {
    const decision = decideSingletonRecluster({
      currentClusterId: 100,
      nearest: { clusterId: 100, distance: 0.01 },
    });

    expect(decision).toEqual({ action: "keep", reason: "same-cluster" });
  });

  it("uses the same similarity threshold and window as Stage A", () => {
    expect(SINGLETON_RECLUSTER_SIMILARITY_THRESHOLD).toBe(0.75);
    expect(SINGLETON_RECLUSTER_WINDOW_HOURS).toBe(72);
  });

  it("treats null maxPerRun as an explicit no-limit backfill request", () => {
    expect(resolveSingletonReclusterLimit(undefined)).toBe(150);
    expect(resolveSingletonReclusterLimit(25)).toBe(25);
    expect(resolveSingletonReclusterLimit(null)).toBeNull();
  });
});

describe("cron singleton recluster wiring", () => {
  it("runs singleton reclustering after Stage A and before duplicate-cluster merge", () => {
    const clusterIdx = pipelineSrc.indexOf("runClusterBatch()");
    const singletonsIdx = pipelineSrc.indexOf("runSingletonReclusterBatch(");
    const mergeIdx = pipelineSrc.indexOf("runMergeBatch(");

    expect(clusterIdx).toBeGreaterThan(0);
    expect(singletonsIdx).toBeGreaterThan(clusterIdx);
    expect(mergeIdx).toBeGreaterThan(singletonsIdx);
  });

  it("respects Stage B split audit when choosing a target cluster", () => {
    expect(pipelineSrc).toContain("runSingletonReclusterBatch(");

    expect(singletonSrc).toContain("FROM cluster_splits split_audit");
    expect(singletonSrc).toContain("split_audit.item_id = ${s.item_id}");
    expect(singletonSrc).toContain(
      "split_audit.from_cluster_id = i.cluster_id",
    );
    expect(singletonSrc).toContain("MAX_DISTINCT_SPLIT_RETRIES_PER_ITEM");
    expect(singletonSrc).toContain(
      "count(DISTINCT split_audit.from_cluster_id)::int",
    );
  });

  it("derives singleton candidate and neighbor eligibility from the visible tier helper", () => {
    const visibleTierFilters =
      singletonSrc.match(/visibleTierInSql\(sql`i\.tier`\)/g) ?? [];

    expect(tierSqlSrc).toContain("VISIBLE_ITEM_TIERS");
    expect(tierSqlSrc).toContain("visibleTierInSql");
    expect(singletonSrc).toContain("visibleTierInSql");
    expect(visibleTierFilters).toHaveLength(2);
  });
});
