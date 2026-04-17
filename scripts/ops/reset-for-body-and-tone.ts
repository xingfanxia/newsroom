/**
 * Reset script for the body_md + tone-rewrite pipeline (session 4).
 *
 * What this does (and why):
 *   1. body_fetched_at = NULL → cron's article-body step fetches markdown
 *      via Jina Reader for every item. Without this, items enriched from
 *      just the RSS description yield summaries that literally say
 *      "info only from title."
 *   2. enriched_at = NULL → cron re-runs the full enrich → embed → score
 *      → commentary pipeline using the new body_md and the rewritten
 *      prompts (stricter banned-phrase lists + per-axis HKR reasons).
 *   3. commentary_at = NULL → forces fresh commentary even if enrichedAt
 *      happens to survive (extra belt + suspenders).
 *
 * Cost (approximate):
 *   - Jina: free tier is 20 RPM; pay-as-you-go if JINA_API_KEY set.
 *   - Enrich + embed + score + commentary ≈ $0.05/item × ~150 items = ~$7.
 *
 * Run with:
 *   bun scripts/ops/reset-for-body-and-tone.ts
 *
 * Idempotent — second run is a no-op since fields are already NULL.
 * Cron ticks process up to 60 body fetches + 50 enriches per run, so a
 * full 150-item backlog catches up over ~3 ticks (~30 min at 10-min cadence).
 */
import { db, closeDb } from "@/db/client";
import { items } from "@/db/schema";
import { isNotNull, sql } from "drizzle-orm";

async function main() {
  const c = db();

  const totalItems = await c.select({ n: sql<number>`count(*)::int` }).from(items);
  console.log("total items in DB:", totalItems[0]?.n ?? 0);

  // 1. body fetch reset — includes NULL rows too (redundant but cheap)
  const bodyReset = await c
    .update(items)
    .set({ bodyFetchedAt: null })
    .where(isNotNull(items.bodyFetchedAt))
    .returning({ id: items.id });
  console.log("body_fetched_at reset:", bodyReset.length);

  // 2. enriched_at reset — triggers full re-pipeline (enrich+embed+score+commentary)
  const enrichedReset = await c
    .update(items)
    .set({ enrichedAt: null })
    .where(isNotNull(items.enrichedAt))
    .returning({ id: items.id });
  console.log("enriched_at reset:", enrichedReset.length);

  // 3. commentary_at reset — forces fresh commentary with new prompt
  const commentaryReset = await c
    .update(items)
    .set({ commentaryAt: null })
    .where(isNotNull(items.commentaryAt))
    .returning({ id: items.id });
  console.log("commentary_at reset:", commentaryReset.length);

  console.log("\nDone. Next cron tick will start the backfill.");
  console.log("Watch /api/admin/system for progress, or run:");
  console.log("  bun scripts/ops/run-cron.ts enrich");

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
