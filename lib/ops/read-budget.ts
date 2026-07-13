/**
 * Read-budget assessment (FIX-W7 / A5). Pure helpers for the Turso rows_read
 * guardrail — the monitor whose absence let the 2026-07-12 read flood run to
 * ~110% of the free cap before anyone noticed. `assessReadBudget` grades the
 * cumulative cycle usage against a cap; `projectMonthlyReads` turns a measured
 * run-rate delta into a projected 30-day total (the "< 100M/mo" check).
 */

const MONTH_MS = 30 * 86_400_000;

export type ReadBudgetVerdict = {
  rowsRead: number;
  capRows: number;
  /** rowsRead / capRows (0 when capRows ≤ 0). */
  fraction: number;
  status: "ok" | "warn" | "over";
  /** true once status leaves "ok" — the cron/alert trip. */
  alert: boolean;
};

/**
 * Grade cumulative cycle usage against a cap. `warnFraction` (default 0.6) is
 * the alert trip; ≥ 1.0 is "over". A non-positive cap yields fraction 0 / "ok"
 * so a misconfigured cap never crashes the monitor.
 */
export function assessReadBudget(
  usage: { rows_read: number },
  opts: { capRows: number; warnFraction?: number },
): ReadBudgetVerdict {
  const warnFraction = opts.warnFraction ?? 0.6;
  const fraction = opts.capRows > 0 ? usage.rows_read / opts.capRows : 0;
  const status: ReadBudgetVerdict["status"] =
    fraction >= 1 ? "over" : fraction >= warnFraction ? "warn" : "ok";
  return {
    rowsRead: usage.rows_read,
    capRows: opts.capRows,
    fraction,
    status,
    alert: status !== "ok",
  };
}

/**
 * Project a measured rows_read delta over an elapsed window to a 30-day month.
 * This is the durable "are we under the monthly target?" signal — the
 * cumulative cycle number is polluted by one-off floods, but a delta between
 * two snapshots on a quiet run is the true steady-state rate. Returns 0 for a
 * non-positive window.
 */
export function projectMonthlyReads(
  deltaRows: number,
  elapsedMs: number,
): number {
  if (elapsedMs <= 0) return 0;
  return (deltaRows / elapsedMs) * MONTH_MS;
}
