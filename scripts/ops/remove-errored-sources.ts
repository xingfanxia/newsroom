/**
 * One-shot cleanup for the 15 errored sources flagged at s8 kickoff.
 *
 * Policy:
 *  - Sources with 0 items → DELETE rows (cascades to source_health). Catalog
 *    entries are removed in the same PR so re-seeding won't bring them back.
 *  - Sources with items → UPDATE enabled=false and clear health state.
 *    Preserves historical items while removing the source from the UI.
 *
 * Run:
 *   bun --env-file=.env.local scripts/ops/remove-errored-sources.ts
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources, sourceHealth } from "@/db/schema";

// 13 zero-item sources safe to fully delete
const DELETE_IDS = [
  "zhihu-hotlist",
  "github-trending",
  "huxiu-ai",
  "jiqizhixin",
  "qbitai",
  "wechat-jiqizhixin-mp",
  "sspai-matrix",
  "36kr-ai",
  "google-deepmind",
  "xiaomi-research",
  "meta-ai",
  "thebatch",
  "rest-of-world",
];

// 2 with items — preserve data, just disable + clear health
const DISABLE_IDS = ["36kr-direct", "sspai-direct"];

async function main() {
  const client = db();

  // Count items per source so we log what we're about to touch
  const itemCounts = await client
    .select({
      sourceId: items.sourceId,
      n: sql<number>`count(*)::int`,
    })
    .from(items)
    .where(inArray(items.sourceId, [...DELETE_IDS, ...DISABLE_IDS]))
    .groupBy(items.sourceId);

  const countBySource = new Map(itemCounts.map((r) => [r.sourceId, r.n]));

  console.log("\n=== About to DELETE ===");
  for (const id of DELETE_IDS) {
    console.log(`  ${id}: ${countBySource.get(id) ?? 0} items`);
  }
  console.log("\n=== About to DISABLE (keep items) ===");
  for (const id of DISABLE_IDS) {
    console.log(`  ${id}: ${countBySource.get(id) ?? 0} items`);
  }

  // Safety: bail if any DELETE_IDS actually has items (shouldn't happen
  // per the audit but guard against drift).
  for (const id of DELETE_IDS) {
    const n = countBySource.get(id) ?? 0;
    if (n > 0) {
      throw new Error(
        `aborting: ${id} has ${n} items but is in DELETE_IDS — add to DISABLE_IDS instead`,
      );
    }
  }

  // 1) Delete health rows first (FK has ON DELETE CASCADE so this is defensive
  //    — makes the log cleaner if anyone tails postgres during the migration).
  await client
    .delete(sourceHealth)
    .where(inArray(sourceHealth.sourceId, DELETE_IDS));
  console.log(`\ndeleted source_health rows for: ${DELETE_IDS.length} ids`);

  // 2) Delete source rows. Cascades to raw_items (which should be empty too).
  await client.delete(sources).where(inArray(sources.id, DELETE_IDS));
  console.log(`deleted source rows for:        ${DELETE_IDS.length} ids`);

  // 3) For DISABLE_IDS: flip enabled=false, reset health counters so they
  //    don't show as erroring on the admin dashboard.
  await client
    .update(sources)
    .set({ enabled: false })
    .where(inArray(sources.id, DISABLE_IDS));
  console.log(`disabled source rows for:       ${DISABLE_IDS.length} ids`);

  // health_status enum is (ok | warning | error | pending) — no 'idle'.
  // Use 'pending' for "disabled, unknown state" so the UI's source-filter
  // doesn't treat these as actively erroring.
  await client
    .update(sourceHealth)
    .set({ status: "pending", consecutiveFailures: 0, lastError: null })
    .where(inArray(sourceHealth.sourceId, DISABLE_IDS));
  console.log(`reset health rows for:          ${DISABLE_IDS.length} ids`);

  // Summary
  const [remaining] = await client
    .select({ n: sql<number>`count(*)::int` })
    .from(sources);
  const [enabled] = await client
    .select({ n: sql<number>`count(*)::int` })
    .from(sources)
    .where(eq(sources.enabled, true));
  console.log(
    `\nafter cleanup: ${remaining?.n ?? 0} sources total, ${enabled?.n ?? 0} enabled`,
  );

  process.exit(0);
}

void main().catch((err) => {
  console.error("cleanup failed:", err);
  process.exit(1);
});
