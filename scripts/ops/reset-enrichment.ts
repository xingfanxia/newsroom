/**
 * Reset enriched_at on items so the enrich worker re-runs them through the
 * new schema (bilingual titles + canonical tags). Idempotent — safe to run
 * again later. Prints before/after counts.
 */
import { db, closeDb } from "@/db/client";
import { items } from "@/db/schema";
import { sql, isNotNull } from "drizzle-orm";

async function main() {
  const c = db();
  const before = await c
    .select({ n: sql<number>`count(*)::int` })
    .from(items)
    .where(isNotNull(items.enrichedAt));
  console.log("enriched before:", before[0]?.n ?? 0);

  const updated = await c
    .update(items)
    .set({ enrichedAt: null })
    .where(isNotNull(items.enrichedAt))
    .returning({ id: items.id });
  console.log("reset rows:", updated.length);

  const after = await c
    .select({ n: sql<number>`count(*)::int` })
    .from(items)
    .where(isNotNull(items.enrichedAt));
  console.log("enriched after:", after[0]?.n ?? 0);

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
