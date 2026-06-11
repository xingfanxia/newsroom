import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  decideSingletonRecluster,
  resolveSingletonReclusterLimit,
  SINGLETON_RECLUSTER_SIMILARITY_THRESHOLD,
  SINGLETON_RECLUSTER_WINDOW_HOURS,
} from "@/workers/cluster/singletons";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cronSrc = readFileSync(
  resolve(__dirname, "../../app/api/cron/cluster/route.ts"),
  "utf8",
);

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
    const clusterIdx = cronSrc.indexOf("runClusterBatch()");
    const singletonsIdx = cronSrc.indexOf("runSingletonReclusterBatch(");
    const mergeIdx = cronSrc.indexOf("runMergeBatch(");

    expect(clusterIdx).toBeGreaterThan(0);
    expect(singletonsIdx).toBeGreaterThan(clusterIdx);
    expect(mergeIdx).toBeGreaterThan(singletonsIdx);
  });
});
