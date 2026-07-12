import { describe, expect, it } from "bun:test";
import { readSource } from "@/tests/helpers/source";

function readOptional(rel: string): string {
  try {
    return readSource(rel);
  } catch {
    return "";
  }
}

describe("enrich worker claim lock", () => {
  const schema = readSource("db/schema.ts");
  const worker = readSource("workers/enrich/index.ts");
  const pendingPredicates = readSource("workers/enrich/pending-predicates.ts");
  const claimState = readOptional("workers/enrich/claim-state.ts");

  it("tracks claim state, attempts, and errors on items", () => {
    expect(schema).toContain('enrichClaimedAt: integer("enrich_claimed_at"');
    expect(schema).toContain('enrichAttempts: integer("enrich_attempts"');
    expect(schema).toContain('enrichError: text("enrich_error")');
  });

  it("claims pending rows atomically before spending LLM calls", () => {
    // Single UPDATE ... WHERE id IN (SELECT ... LIMIT n) RETURNING — SQLite is
    // single-writer, so the whole claim serializes (replaced the Postgres
    // FOR UPDATE SKIP LOCKED writable CTE).
    expect(worker).toContain("claimPendingEnrichItems");
    expect(worker).toMatch(/UPDATE \$\{items\}[\s\S]+?RETURNING \$\{items\.id\} AS id/);
    expect(worker).toContain("enrich_claimed_at = ${Date.now()}");
    expect(worker).toContain("enrich_attempts = coalesce(enrich_attempts, 0) + 1");
  });

  it("waits for body prefetch before claiming non-X web items", () => {
    expect(worker).toContain("./pending-predicates");
    expect(worker).toContain("enrichClaimableSql(items, { maxAttempts })");
    expect(pendingPredicates).toContain("@/lib/urls/media");
    expect(pendingPredicates).toContain("enrichBodyPrefetchReadySql(");
    expect(pendingPredicates).toContain("columns.bodyFetchedAt");
    expect(pendingPredicates).toContain("columns.canonicalUrl");
    expect(worker).not.toContain("BODY_PREFETCH_READY_SQL");
    expect(pendingPredicates).not.toContain("BODY_PREFETCH_READY_SQL");
    expect(pendingPredicates).not.toContain("x.com/%/status/%");
    expect(pendingPredicates).not.toContain("twitter.com/%/status/%");
  });

  it("backs off failed rows and caps automatic retries", () => {
    expect(worker).toContain("ENRICH_MAX_ATTEMPTS");
    expect(pendingPredicates).toContain("ENRICH_CLAIM_STALE_MINUTES");
    expect(pendingPredicates).toContain("ENRICH_MAX_ATTEMPTS");
    expect(worker).toContain("markEnrichFailure");
    expect(pendingPredicates).toContain(
      "coalesce(${columns.enrichAttempts}, 0) <",
    );
  });

  it("clears claim state when reset scripts intentionally requeue items", () => {
    expect(claimState).toContain("ENRICH_CLAIM_RESET_VALUES");
    expect(claimState).toContain("enrichClaimedAt: null");
    expect(claimState).toContain("enrichAttempts: 0");
    expect(claimState).toContain("enrichError: null");
    expect(worker).toContain("ENRICH_CLAIM_RESET_VALUES");

    for (const rel of [
      "scripts/ops/reset-enrichment.ts",
      "scripts/ops/reset-curated-for-backfill.ts",
      "scripts/ops/reset-for-body-and-tone.ts",
    ]) {
      const src = readSource(rel);
      expect(src).toContain("ENRICH_CLAIM_RESET_VALUES");
      expect(src).not.toContain("enrichClaimedAt: null");
      expect(src).not.toContain("enrichAttempts: 0");
      expect(src).not.toContain("enrichError: null");
    }
  });
});
