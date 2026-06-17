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
  const claimState = readOptional("workers/enrich/claim-state.ts");
  const migration = readOptional(
    "db/migrations/manual/2026-06-11-enrich-claim-lock.sql",
  );

  it("tracks claim state, attempts, and errors on items", () => {
    expect(schema).toContain('enrichClaimedAt: timestamp("enrich_claimed_at"');
    expect(schema).toContain('enrichAttempts: integer("enrich_attempts"');
    expect(schema).toContain('enrichError: text("enrich_error")');
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS enrich_claimed_at");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS enrich_attempts");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS enrich_error");
  });

  it("claims pending rows atomically before spending LLM calls", () => {
    expect(worker).toContain("FOR UPDATE SKIP LOCKED");
    expect(worker).toContain("claimPendingEnrichItems");
    expect(worker).toContain("enrich_claimed_at = now()");
    expect(worker).toContain("enrich_attempts = coalesce(enrich_attempts, 0) + 1");
  });

  it("waits for body prefetch before claiming non-X web items", () => {
    expect(worker).toContain("@/lib/urls/media");
    expect(worker).toContain("enrichBodyPrefetchReadySql(");
    expect(worker).toContain("items.bodyFetchedAt");
    expect(worker).toContain("items.canonicalUrl");
    expect(worker).not.toContain("BODY_PREFETCH_READY_SQL");
    expect(worker).not.toContain("x.com/%/status/%");
    expect(worker).not.toContain("twitter.com/%/status/%");
  });

  it("backs off failed rows and caps automatic retries", () => {
    expect(worker).toContain("CLAIM_STALE_MINUTES");
    expect(worker).toContain("MAX_ATTEMPTS");
    expect(worker).toContain("markEnrichFailure");
    expect(worker).toContain("coalesce(${items.enrichAttempts}, 0) <");
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
