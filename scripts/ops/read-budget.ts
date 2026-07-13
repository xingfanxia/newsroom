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
import { assessReadBudget, projectMonthlyReads } from "@/lib/ops/read-budget";

// Grade against the FREE cap even on Developer — the W7 goal is to sit well
// under free, so the free cap is the meaningful safety line.
const FREE_CAP_ROWS = 500_000_000;
const MONTHLY_TARGET_ROWS = 100_000_000;

async function fetchUsage(
  path: string,
): Promise<{ rows_read: number; rows_written: number } | null> {
  const token = process.env.TURSO_API_TOKEN;
  const org = process.env.TURSO_ORG ?? "xingfanxia";
  if (!token) return null;
  const res = await fetch(`https://api.turso.tech/v1/organizations/${org}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = (await res.json()) as {
    total?: { rows_read?: number; rows_written?: number };
  };
  return {
    rows_read: j.total?.rows_read ?? 0,
    rows_written: j.total?.rows_written ?? 0,
  };
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

  const org = await fetchUsage("/usage");
  const dbUsage = await fetchUsage("/databases/newsroom-v2/usage");
  const usage = dbUsage ?? org;
  if (!usage) {
    console.error("failed to fetch Turso usage");
    process.exitCode = 1;
    return;
  }

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
      // Baseline is a per-DB vs org mismatch, or the billing cycle reset —
      // a negative delta is not a real rate, don't project a bogus "OK".
      console.log(
        `run-rate: prev ${prevRows.toLocaleString()} > current ` +
          `${usage.rows_read.toLocaleString()} — baseline mismatch or cycle ` +
          `reset; skipping projection`,
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
