/**
 * Read-budget monitor (FIX-W7 / A5). Reads Turso rows_read for newsroom-v2 and
 * guards it two ways, so it can run as a cron and FAIL LOUD (exit 1) on a real
 * problem:
 *
 *  1. Run-rate projection (the primary, durable signal): a rolling window of
 *     recent readings → projected 30-day total; trips at ALERT_ROWS (60M/mo).
 *     This is what the flood-polluted cumulative can't give — it's the true
 *     steady-state rate. Smoothed over up to RETENTION_DAYS so a single busy /
 *     backfill day doesn't false-red.
 *  2. Cumulative catastrophe backstop: trips if the cumulative cycle usage nears
 *     the ACTUAL plan cap (CUMULATIVE_HARD_CAP_ROWS) — a runaway the run-rate
 *     smoothing might lag. NOT the free cap: this cycle is polluted to ~556M by
 *     the one-off migration flood, so grading against 500M would false-red every
 *     run; the free cap is printed as an informational goal line only.
 *
 * State: a small JSON history file (SNAPSHOT_IN read → SNAPSHOT_OUT written,
 * same path in the cron). No DB — the cron carries it via actions/cache.
 *
 * Run:   bun --env-file=.env.local scripts/ops/read-budget.ts
 * (billing needs TURSO_API_TOKEN — `set -a; source ~/.claude/turso.env; set +a`)
 *
 * Manual run-rate seed (bypasses the file): PREV_ROWS + PREV_AT env.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  assessReadBudget,
  parseUsageTotals,
  projectMonthlyReads,
} from "@/lib/ops/read-budget";

// Free cap is the W7 GOAL line (printed, not a trip — the cycle is flood-polluted
// this month). The cumulative TRIP is calibrated to the current plan's real cap.
const FREE_CAP_ROWS = 500_000_000;
// Steady-state monthly target (the goal, ~15M projected). ALERT trips below it to
// leave investigation headroom — matches the A5 spec ("alert at 60M/mo").
const MONTHLY_TARGET_ROWS = 100_000_000;
const ALERT_ROWS = 60_000_000;
// Catastrophe backstop: 90% of the Developer plan's 2.5B cap. Tighten to
// FREE_CAP_ROWS if this DB is ever moved back to the Free plan.
const CUMULATIVE_HARD_CAP_ROWS = 2_250_000_000;
// Rolling projection window: readings older than this are pruned, so the run-rate
// is a ≤7-day average — a single spike day is diluted, not amplified.
export const RETENTION_DAYS = 7;
// A window shorter than this is dominated by extrapolation noise (a huge
// MONTH_MS/elapsed factor), so report the raw delta instead of tripping. Guards
// the first day or two of history and any sub-window manual dispatch.
const MIN_PROJECT_HOURS = 12;

export type Reading = { rows_read: number; captured_at: string };

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

export function isReading(v: unknown): v is Reading {
  const r = v as { rows_read?: unknown; captured_at?: unknown } | null;
  return (
    !!r &&
    typeof r.rows_read === "number" &&
    Number.isFinite(r.rows_read) &&
    typeof r.captured_at === "string" &&
    Number.isFinite(Date.parse(r.captured_at))
  );
}

/**
 * Load the rolling reading history, pruned to RETENTION_DAYS relative to `now`.
 * Prefers the SNAPSHOT_IN file (an array; legacy single-object snapshots and the
 * PREV_ROWS/PREV_AT env are accepted as a one-entry seed). Returns `corrupt:true`
 * when the file EXISTS but is unparseable/invalid — a corrupted baseline must
 * fail loud (a silently-blind guardrail is the failure mode this monitor exists
 * to prevent), distinct from "no file yet" (a legitimate first run).
 */
export function loadHistory(
  now: number,
): { history: Reading[]; corrupt: boolean } {
  const cutoff = now - RETENTION_DAYS * 86_400_000;
  const prune = (rs: Reading[]) =>
    rs
      .filter((r) => Date.parse(r.captured_at) > cutoff)
      .sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));

  const inPath = process.env.SNAPSHOT_IN;
  if (inPath && existsSync(inPath)) {
    try {
      const raw: unknown = JSON.parse(readFileSync(inPath, "utf8"));
      const arr = Array.isArray(raw) ? raw : [raw];
      const readings = arr.filter(isReading);
      if (readings.length === 0) throw new Error("no valid readings in file");
      return { history: prune(readings), corrupt: false };
    } catch (err) {
      console.error(
        `SNAPSHOT_IN corrupt (${inPath}) — ${err instanceof Error ? err.message : String(err)}`,
      );
      return { history: [], corrupt: true };
    }
  }

  const rows = Number(process.env.PREV_ROWS);
  const at = process.env.PREV_AT ? Date.parse(process.env.PREV_AT) : NaN;
  if (Number.isFinite(rows) && Number.isFinite(at)) {
    return {
      history: prune([{ rows_read: rows, captured_at: new Date(at).toISOString() }]),
      corrupt: false,
    };
  }
  return { history: [], corrupt: false };
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

  // Load prior readings BEFORE writing the new one (SNAPSHOT_IN/OUT are the same
  // file in the cron). `oldest` anchors the projection to a multi-day window, so
  // a re-run appending a duplicate reading can't collapse it to ~0 (green-flip).
  const { history: prior, corrupt } = loadHistory(now);
  const oldest = prior[0];

  // Grade newsroom-v2's per-DB usage directly. (Grading the org total against a
  // per-DB baseline was the source of the negative-delta "baseline mismatch"
  // noise; per-DB is the number the read budget is actually about.)
  const usage = await fetchUsage("/databases/newsroom-v2/usage");

  // Persist the appended + pruned history for the next run.
  const snapshotOut = process.env.SNAPSHOT_OUT;
  if (snapshotOut) {
    const next: Reading[] = [
      ...prior,
      { rows_read: usage.rows_read, captured_at: new Date(now).toISOString() },
    ];
    writeFileSync(snapshotOut, JSON.stringify(next));
    console.log(`snapshot → ${snapshotOut} (${next.length} readings retained)`);
  }

  const verdict = assessReadBudget(usage, { capRows: FREE_CAP_ROWS });
  console.log(`newsroom-v2 rows_read (cycle): ${usage.rows_read.toLocaleString()}`);
  console.log(
    `vs free-cap goal ${FREE_CAP_ROWS.toLocaleString()}: ${pct(verdict.fraction)} ` +
      `[${verdict.status}] (informational — this cycle is polluted by the ` +
      `migration-day flood; the run-rate below is the durable guardrail)`,
  );

  let tripped = false;

  // Backstop: a genuine runaway toward the real plan cap, independent of the
  // run-rate smoothing.
  if (usage.rows_read > CUMULATIVE_HARD_CAP_ROWS) {
    console.error(
      `ALERT: cumulative ${usage.rows_read.toLocaleString()} > hard cap ` +
        `${CUMULATIVE_HARD_CAP_ROWS.toLocaleString()} (near the plan limit)`,
    );
    tripped = true;
  }

  // A corrupt baseline means the run-rate guardrail is blind — fail loud. We
  // already wrote a fresh snapshot above, so the next run self-heals.
  if (corrupt) {
    console.error(
      "ALERT: prior snapshot was corrupt — run-rate guardrail was blind this " +
        "run (a fresh baseline was written; next run recovers)",
    );
    tripped = true;
  }

  // Primary guardrail: rolling-window run-rate projection.
  if (oldest) {
    const delta = usage.rows_read - oldest.rows_read;
    const elapsedMs = now - Date.parse(oldest.captured_at);
    const elapsedH = elapsedMs / 3_600_000;
    if (delta < 0) {
      // Current < oldest ⇒ the billing cycle rolled over mid-window (usage reset
      // to ~0). Not a real rate — skip; pruning ages out the pre-reset readings.
      console.log(
        `run-rate: oldest ${oldest.rows_read.toLocaleString()} > current ` +
          `${usage.rows_read.toLocaleString()} — billing cycle reset; ` +
          `skipping projection`,
      );
    } else if (elapsedH < MIN_PROJECT_HOURS) {
      console.log(
        `run-rate: +${delta.toLocaleString()} over ${elapsedH.toFixed(1)}h — ` +
          `window < ${MIN_PROJECT_HOURS}h, too short to project; informational`,
      );
    } else {
      const projected = projectMonthlyReads(delta, elapsedMs);
      const over = projected > ALERT_ROWS;
      console.log(
        `run-rate: +${delta.toLocaleString()} over ${elapsedH.toFixed(1)}h → ` +
          `projected ${Math.round(projected).toLocaleString()}/mo ` +
          `(alert ${ALERT_ROWS.toLocaleString()}, target ` +
          `${MONTHLY_TARGET_ROWS.toLocaleString()}: ${over ? "OVER" : "OK"})`,
      );
      if (over) tripped = true;
    }
  } else {
    console.log(
      "run-rate: no prior reading — informational only " +
        "(this run seeds the history for the next projection)",
    );
  }

  if (tripped) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error("read-budget failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
