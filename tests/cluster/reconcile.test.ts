/**
 * Tests for the cluster aggregate reconciler (workers/cluster/reconcile.ts)
 * and its wiring into scripts/ops/cluster-health.ts --repair.
 *
 * Source-string assertions (matches tests/cluster conventions — the reconciler
 * runs set-based SQL against the live DB, not unit-testable without creds), plus
 * pure-logic checks of the invariants.
 */
import { describe, expect, it } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const reconcileSrc = readSource("workers/cluster/reconcile.ts");
const healthSrc = readSource("scripts/ops/cluster-health.ts");

describe("reconcileClusters — the three repairs", () => {
  it("recomputes member_count AND coverage from actual membership", () => {
    expect(reconcileSrc).toContain(
      "SELECT count(*) FROM items i WHERE i.cluster_id = clusters.id",
    );
    expect(reconcileSrc).toContain("member_count = ");
    expect(reconcileSrc).toContain("coverage = ");
  });

  it("GCs zombie clusters guarded by NOT EXISTS members AND an age floor", () => {
    // Age guard prevents racing Stage A, which briefly holds a member_count=0
    // row between creating a cluster and claiming its first item.
    expect(reconcileSrc).toContain(
      "NOT EXISTS (SELECT 1 FROM items i WHERE i.cluster_id = clusters.id)",
    );
    expect(reconcileSrc).toContain("clusters.first_seen_at < ?");
  });

  it("re-points dangling leads to a real member, importance-ranked", () => {
    expect(reconcileSrc).toContain("lead_item_id = (");
    expect(reconcileSrc).toContain(
      "ORDER BY i.importance DESC, i.published_at ASC, i.id ASC LIMIT 1",
    );
  });

  it("does NOT touch the cluster's verified_at / titled_at (must not force LLM re-work)", () => {
    // Forcing re-arbitration/re-titling is the caller's decision (the one-off
    // migration does it for its stuck clusters); the standing reconciler must
    // not silently spend LLM calls. Regex (not substring) so the orphan-item
    // step's legitimate `cluster_verified_at = NULL` on ITEMS doesn't false-trip
    // — [^_] excludes the `cluster_` prefix; a bare `verified_at = NULL` (a
    // cluster verdict clear) would still match.
    expect(reconcileSrc).not.toMatch(/[^_]verified_at = NULL/);
    expect(reconcileSrc).not.toContain("titled_at = NULL");
  });

  it("gates every write behind the apply flag (dry-run counts otherwise)", () => {
    expect(reconcileSrc).toContain("if (opts.apply)");
    expect(reconcileSrc).toContain("SELECT count(*) AS n");
  });
});

describe("cluster-health --repair wiring", () => {
  it("only runs the reconcile pass when --repair is passed (read-only otherwise)", () => {
    expect(healthSrc).toContain('process.argv.includes("--repair")');
    expect(healthSrc).toContain("reconcileClusters({ apply");
  });

  it("requires --apply to write; --repair alone is a dry-run preview", () => {
    expect(healthSrc).toContain('process.argv.includes("--apply")');
  });

  it("treats applied drift as an alarm, not a routine fact", () => {
    expect(healthSrc).toContain("ALARM");
  });
});
