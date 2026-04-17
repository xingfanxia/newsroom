/**
 * Regenerate editor commentary for a set of items with the current prompt.
 *
 * Usage:
 *   bun scripts/ops/regen-commentary-preview.ts 2073 2074 2750
 *   bun scripts/ops/regen-commentary-preview.ts --all-curated
 *
 * Resets commentary_at + editor_note_{zh,en} + editor_analysis_{zh,en} for
 * the selected items, then invokes runCommentaryBackfill (the same path cron
 * uses). Prints the resulting zh note + analysis for each id so you can spot-
 * check the tone before deciding whether to roll it out wider.
 */
import { inArray } from "drizzle-orm";
import { db, closeDb } from "@/db/client";
import { items } from "@/db/schema";
import { runCommentaryBackfill } from "@/workers/enrich/commentary";

async function resolveTargets(args: string[]): Promise<number[]> {
  if (args.includes("--all-curated")) {
    const rows = await db()
      .select({ id: items.id })
      .from(items)
      .where(inArray(items.tier, ["featured", "p1", "all"]));
    return rows.map((r) => r.id);
  }
  const ids = args
    .map((a) => Number.parseInt(a, 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return [];
  const found = await db()
    .select({ id: items.id })
    .from(items)
    .where(inArray(items.id, ids));
  return found.map((r) => r.id);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "usage: bun scripts/ops/regen-commentary-preview.ts <id> [<id>...]\n" +
        "       bun scripts/ops/regen-commentary-preview.ts --all-curated",
    );
    process.exit(2);
  }

  const targetIds = await resolveTargets(args);
  if (targetIds.length === 0) {
    console.error("no matching items — exiting");
    await closeDb();
    return;
  }

  console.log(
    `resetting commentary for ${targetIds.length} item(s):`,
    targetIds.slice(0, 20).join(",") + (targetIds.length > 20 ? ",…" : ""),
  );
  await db()
    .update(items)
    .set({
      commentaryAt: null,
      editorNoteZh: null,
      editorNoteEn: null,
      editorAnalysisZh: null,
      editorAnalysisEn: null,
    })
    .where(inArray(items.id, targetIds));

  console.log("running commentary backfill…");
  const report = await runCommentaryBackfill();
  console.log("report:", JSON.stringify(report, null, 2));

  const rows = await db()
    .select()
    .from(items)
    .where(inArray(items.id, targetIds));
  for (const r of rows) {
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`[${r.id}] ${r.title}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("editorNoteZh:", r.editorNoteZh);
    console.log("\neditorAnalysisZh:\n");
    console.log(r.editorAnalysisZh);
  }

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
