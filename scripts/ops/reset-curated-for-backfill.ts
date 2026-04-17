/**
 * Scoped reset — only non-excluded items (featured / p1 / all). Forces
 * re-enrichment + re-commentary with the new body_md + rewritten prompts
 * while leaving excluded items (112) and unenriched items (~2000+) alone.
 *
 * Cost: ~38 items × ($0.003 enrich + $0.01 score + $0.02 commentary + embed) ≈ $1-2.
 *
 * Run with:
 *   bun scripts/ops/reset-curated-for-backfill.ts
 *
 * Then trigger the enrich cron locally OR wait for the next cron tick:
 *   bun scripts/ops/run-cron.ts enrich   # runs once; repeat until queue empty
 */
import { db, closeDb } from "@/db/client";
import { items } from "@/db/schema";
import { and, inArray, isNotNull, sql } from "drizzle-orm";

async function main() {
  const c = db();

  const counts = await c
    .select({ tier: items.tier, n: sql<number>`count(*)::int` })
    .from(items)
    .where(
      and(inArray(items.tier, ["featured", "p1", "all"]), isNotNull(items.enrichedAt)),
    )
    .groupBy(items.tier);
  console.log("enriched curated by tier:", counts);

  const enrichedReset = await c
    .update(items)
    .set({ enrichedAt: null })
    .where(
      and(inArray(items.tier, ["featured", "p1", "all"]), isNotNull(items.enrichedAt)),
    )
    .returning({ id: items.id });
  console.log(`enriched_at reset: ${enrichedReset.length} items`);

  const commentaryReset = await c
    .update(items)
    .set({ commentaryAt: null })
    .where(
      and(inArray(items.tier, ["featured", "p1", "all"]), isNotNull(items.commentaryAt)),
    )
    .returning({ id: items.id });
  console.log(`commentary_at reset: ${commentaryReset.length} items`);

  console.log(
    "\nDone. Run `bun scripts/ops/run-cron.ts enrich` to process locally, or wait for next cron tick.",
  );

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
