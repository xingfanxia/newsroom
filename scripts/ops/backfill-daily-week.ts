import { runDailyColumn } from "@/workers/newsletter/run-daily-column";
import { previousDailyColumnRunTimes } from "@/workers/newsletter/windows";

const reports = [];
const runTimes = previousDailyColumnRunTimes(7);
for (const [idx, t] of runTimes.entries()) {
  const i = idx + 1;
  const date = t.toISOString().slice(0, 10);
  console.log(`[${i}/7] regenerating column for ${date} (window ending ${t.toISOString()})...`);
  try {
    const r = await runDailyColumn({ now: t, force: true });
    console.log(`  → ${r.generated ? `id=${r.generated.newsletterId}` : "skipped"}, story_count=${r.storyCount}, qcHits=${r.qcHits}, ${r.durationMs}ms`);
    reports.push({ date, ...r });
  } catch (e) {
    console.error(`  → FAILED: ${e instanceof Error ? e.message : e}`);
    reports.push({ date, error: String(e) });
  }
}
console.log("\n=== summary ===");
console.log(JSON.stringify(reports, null, 2));
