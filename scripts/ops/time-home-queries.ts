/**
 * Time each data function the /zh home page runs, against prod Turso.
 * Diagnostic for the 2026-07-12 slow-TTFB report. Run: bun scripts/ops/time-home-queries.ts
 */
import { getFeaturedStories } from "@/lib/items/live";
import {
  getDayCounts,
  getPolicySummary,
  getTopTopics,
} from "@/lib/shell/dashboard-stats";
import { getShellChromeData } from "@/lib/shell/chrome-data";
import { getRecentTickerItems } from "@/lib/shell/ticker";
import { closeDb } from "@/db/client";

async function timeIt<T>(name: string, fn: () => Promise<T>) {
  const t0 = performance.now();
  try {
    const r = await fn();
    const ms = (performance.now() - t0).toFixed(0);
    const size = Array.isArray(r) ? r.length : "-";
    console.log(`${name}: ${ms}ms (rows=${size})`);
  } catch (e) {
    console.log(`${name}: FAILED after ${(performance.now() - t0).toFixed(0)}ms — ${e}`);
  }
}

async function main() {
  // serial, like the page: featured first
  await timeIt("getFeaturedStories(today,limit=120)", () =>
    getFeaturedStories({ tier: "featured", locale: "zh", limit: 120, view: "today" }),
  );
  await timeIt("getShellChromeData", () =>
    getShellChromeData({ pulse: true, signalRatio: "fromRadar" }),
  );
  await timeIt("getTopTopics", () => getTopTopics());
  await timeIt("getPolicySummary", () => getPolicySummary());
  await timeIt("getRecentTickerItems", () => getRecentTickerItems("zh"));
  await timeIt("getDayCounts(60)", () => getDayCounts(60, { tier: "featured" }));
  // second pass to separate connection warmup from steady-state
  console.log("--- pass 2 (warm) ---");
  await timeIt("getFeaturedStories(today,limit=120)", () =>
    getFeaturedStories({ tier: "featured", locale: "zh", limit: 120, view: "today" }),
  );
  await timeIt("getDayCounts(60)", () => getDayCounts(60, { tier: "featured" }));
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
