/**
 * Read-budget monitor (FIX-W7 / A5). Snapshots Turso rows_read for the org and
 * for newsroom-v2, grades the cumulative cycle usage against a cap, and — if a
 * previous snapshot is supplied — projects the measured run-rate to a 30-day
 * month (the durable "< 100M/mo" check that the flood-polluted cumulative can't
 * give). Exits non-zero when the cap guardrail trips, so it can run as a cron.
 *
 * Run:   bun --env-file=.env.local scripts/ops/read-budget.ts
 * (billing needs TURSO_API_TOKEN — `set -a; source ~/.claude/turso.env; set +a`)
 *
 * Run-rate: pass the prior snapshot to project the steady-state monthly total:
 *   PREV_ROWS=566269103 PREV_AT=2026-07-12T09:00:00Z \
 *     bun --env-file=.env.local scripts/ops/read-budget.ts
 */
import {
  assessReadBudget,
  parseUsageTotals,
  projectMonthlyReads,
} from "@/lib/ops/read-budget";

// Grade against the FREE cap even on Developer — the W7 goal is to sit well
// under free, so the free cap is the meaningful safety line.
const FREE_CAP_ROWS = 500_000_000;
const MONTHLY_TARGET_ROWS = 100_000_000;

/**
 * Fetch a Turso usage endpoint and FAIL LOUD on any error — the whole point of
 * this guardrail is to trip on a real overage, so an API failure that coerced
 * rows_read to 0 would silently report "ok" (worse than no monitor). Throws on
 * missing token, non-2xx, or a missing/NaN rows_read. The caller's exit-1 catch
 * turns any throw into a red cron.
 */
async function fetchUsage(
  path: string,
): Promise<{ rows_read: number; rows_written: number }> {
  const token = process.env.TURSO_API_TOKEN;
  const org = process.env.TURSO_ORG ?? "xingfanxia";
  if (!token) throw new Error("no TURSO_API_TOKEN");
  const res = await fetch(`https://api.turso.tech/v1/organizations/${org}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Turso usage ${path} → HTTP ${res.status} ${res.statusText}`);
  }
  return parseUsageTotals(await res.json());
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

async function main() {
  if (!process.env.TURSO_API_TOKEN) {
    console.error(
      "no TURSO_API_TOKEN — `set -a; source ~/.claude/turso.env; set +a` first",
    );
    process.exitCode = 1;
    return;
  }

  // Grade newsroom-v2's per-DB usage directly. (Grading the org total against a
  // per-DB baseline was the source of the negative-delta "baseline mismatch"
  // noise; per-DB is the number the read budget is actually about.)
  const usage = await fetchUsage("/databases/newsroom-v2/usage");

  const verdict = assessReadBudget(usage, { capRows: FREE_CAP_ROWS });
  console.log(`newsroom-v2 rows_read (cycle): ${usage.rows_read.toLocaleString()}`);
  console.log(
    `vs free cap ${FREE_CAP_ROWS.toLocaleString()}: ${pct(verdict.fraction)} [${verdict.status}]`,
  );

  const prevRows = Number(process.env.PREV_ROWS);
  const prevAt = process.env.PREV_AT ? Date.parse(process.env.PREV_AT) : NaN;
  if (Number.isFinite(prevRows) && Number.isFinite(prevAt)) {
    const delta = usage.rows_read - prevRows;
    const elapsedMs = Date.now() - prevAt;
    if (delta < 0) {
      // Current < prev means the billing cycle rolled over (usage reset to ~0)
      // — a negative delta is not a real rate, don't project a bogus "OK".
      console.log(
        `run-rate: prev ${prevRows.toLocaleString()} > current ` +
          `${usage.rows_read.toLocaleString()} — billing cycle reset; ` +
          `skipping projection`,
      );
    } else {
      const projected = projectMonthlyReads(delta, elapsedMs);
      const underTarget = projected <= MONTHLY_TARGET_ROWS;
      console.log(
        `run-rate: +${delta.toLocaleString()} over ` +
          `${(elapsedMs / 3_600_000).toFixed(1)}h → projected ` +
          `${Math.round(projected).toLocaleString()}/mo ` +
          `(target ${MONTHLY_TARGET_ROWS.toLocaleString()}: ${underTarget ? "OK" : "OVER"})`,
      );
    }
  } else {
    console.log(
      "run-rate: pass PREV_ROWS + PREV_AT to project the steady-state monthly total",
    );
  }

  if (verdict.alert) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error("read-budget failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
