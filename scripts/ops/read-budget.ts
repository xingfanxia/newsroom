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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  assessReadBudget,
  parseUsageTotals,
  projectMonthlyReads,
} from "@/lib/ops/read-budget";

// Grade against the FREE cap even on Developer — the W7 goal is to sit well
// under free, so the free cap is the meaningful safety line.
const FREE_CAP_ROWS = 500_000_000;
const MONTHLY_TARGET_ROWS = 100_000_000;
// A projection over too short a window is dominated by noise (a single tick's
// reads × a huge extrapolation factor). Only trip the alarm on a window wide
// enough to be a real rate — the daily cron gives ~24h; this only guards manual
// re-runs minutes apart.
const MIN_PROJECT_HOURS = 2;

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

/**
 * Resolve the prior reading for the run-rate diff. Prefers a snapshot FILE
 * (`SNAPSHOT_IN` — how the cron carries state between daily runs, so the
 * workflow needs no shell-side variable extraction), falling back to explicit
 * `PREV_ROWS`/`PREV_AT` env (manual CLI use). Returns null when neither yields a
 * finite pair. A malformed file warns and falls through rather than crashing —
 * a missing baseline degrades to "informational", never a false alarm.
 */
function resolvePrevSnapshot(): { rows: number; at: number } | null {
  const inPath = process.env.SNAPSHOT_IN;
  if (inPath && existsSync(inPath)) {
    try {
      const raw = JSON.parse(readFileSync(inPath, "utf8")) as {
        rows_read?: unknown;
        captured_at?: unknown;
      };
      const rows = Number(raw.rows_read);
      const at = raw.captured_at ? Date.parse(String(raw.captured_at)) : NaN;
      if (Number.isFinite(rows) && Number.isFinite(at)) return { rows, at };
    } catch (err) {
      console.warn(
        `SNAPSHOT_IN unreadable (${inPath}); ignoring — ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const rows = Number(process.env.PREV_ROWS);
  const at = process.env.PREV_AT ? Date.parse(process.env.PREV_AT) : NaN;
  if (Number.isFinite(rows) && Number.isFinite(at)) return { rows, at };
  return null;
}

async function main() {
  const now = Date.now();
  if (!process.env.TURSO_API_TOKEN) {
    console.error(
      "no TURSO_API_TOKEN — `set -a; source ~/.claude/turso.env; set +a` first",
    );
    process.exitCode = 1;
    return;
  }

  // Resolve the prior reading BEFORE writing SNAPSHOT_OUT — the cron points
  // SNAPSHOT_IN and SNAPSHOT_OUT at the same file, so read yesterday's value
  // first, then overwrite it with today's below.
  const prev = resolvePrevSnapshot();

  // Grade newsroom-v2's per-DB usage directly. (Grading the org total against a
  // per-DB baseline was the source of the negative-delta "baseline mismatch"
  // noise; per-DB is the number the read budget is actually about.)
  const usage = await fetchUsage("/databases/newsroom-v2/usage");

  // Persist this reading so the NEXT run has a prior snapshot to diff against
  // (the cron restores this file into SNAPSHOT_IN, runs, then re-saves it).
  const snapshotOut = process.env.SNAPSHOT_OUT;
  if (snapshotOut) {
    writeFileSync(
      snapshotOut,
      JSON.stringify({
        rows_read: usage.rows_read,
        captured_at: new Date(now).toISOString(),
      }),
    );
    console.log(`snapshot → ${snapshotOut}`);
  }

  const verdict = assessReadBudget(usage, { capRows: FREE_CAP_ROWS });
  console.log(`newsroom-v2 rows_read (cycle): ${usage.rows_read.toLocaleString()}`);
  console.log(
    `vs free cap ${FREE_CAP_ROWS.toLocaleString()}: ${pct(verdict.fraction)} ` +
      `[${verdict.status}] (informational — the cumulative cycle is polluted by ` +
      `the migration-day flood; the run-rate below is the durable guardrail)`,
  );

  // The DURABLE guardrail is the run-rate projection, NOT the flood-polluted
  // cumulative — exit non-zero ONLY when a measured run-rate projects over the
  // monthly target. With no prior snapshot the rate is unknowable, so the run is
  // informational (exit 0) rather than false-red on the polluted cumulative.
  if (prev) {
    const delta = usage.rows_read - prev.rows;
    const elapsedMs = now - prev.at;
    const elapsedH = elapsedMs / 3_600_000;
    if (delta < 0) {
      // Current < prev means the billing cycle rolled over (usage reset to ~0)
      // — a negative delta is not a real rate, don't project a bogus "OK".
      console.log(
        `run-rate: prev ${prev.rows.toLocaleString()} > current ` +
          `${usage.rows_read.toLocaleString()} — billing cycle reset; ` +
          `skipping projection`,
      );
    } else if (elapsedH < MIN_PROJECT_HOURS) {
      // Window too short to be a real rate — report the raw delta, don't alarm.
      console.log(
        `run-rate: +${delta.toLocaleString()} over ${elapsedH.toFixed(1)}h — ` +
          `window < ${MIN_PROJECT_HOURS}h, too short to project; informational`,
      );
    } else {
      const projected = projectMonthlyReads(delta, elapsedMs);
      const overTarget = projected > MONTHLY_TARGET_ROWS;
      console.log(
        `run-rate: +${delta.toLocaleString()} over ` +
          `${elapsedH.toFixed(1)}h → projected ` +
          `${Math.round(projected).toLocaleString()}/mo ` +
          `(target ${MONTHLY_TARGET_ROWS.toLocaleString()}: ${overTarget ? "OVER" : "OK"})`,
      );
      if (overTarget) process.exitCode = 1;
    }
  } else {
    console.log(
      "run-rate: no prior snapshot — informational only " +
        "(next run diffs against this one to project the steady-state rate)",
    );
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error("read-budget failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
