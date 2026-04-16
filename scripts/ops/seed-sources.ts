/**
 * One-shot seed script: populate `sources` + `source_health` from lib/sources/catalog.ts.
 * Safe to re-run — uses ON CONFLICT DO UPDATE on id.
 *
 * Usage:
 *   bun run db:seed
 * or:
 *   tsx scripts/ops/seed-sources.ts
 */

import { db } from "@/db/client";
import { sources, sourceHealth } from "@/db/schema";
import { sourceCatalog } from "@/lib/sources/catalog";
import { sql } from "drizzle-orm";

async function main() {
  const client = db();

  console.log(`seeding ${sourceCatalog.length} sources…`);

  for (const s of sourceCatalog) {
    await client
      .insert(sources)
      .values({
        id: s.id,
        nameEn: s.name.en,
        nameZh: s.name.zh,
        url: s.url,
        kind: s.kind,
        group: s.group,
        locale: s.locale,
        cadence: s.cadence,
        priority: s.priority,
        tags: s.tags,
        enabled: s.enabled,
        notes: s.notes ?? null,
      })
      .onConflictDoUpdate({
        target: sources.id,
        set: {
          nameEn: sql`EXCLUDED.name_en`,
          nameZh: sql`EXCLUDED.name_zh`,
          url: sql`EXCLUDED.url`,
          kind: sql`EXCLUDED.kind`,
          group: sql`EXCLUDED.group`,
          locale: sql`EXCLUDED.locale`,
          cadence: sql`EXCLUDED.cadence`,
          priority: sql`EXCLUDED.priority`,
          tags: sql`EXCLUDED.tags`,
          enabled: sql`EXCLUDED.enabled`,
          notes: sql`EXCLUDED.notes`,
          updatedAt: sql`now()`,
        },
      });

    await client
      .insert(sourceHealth)
      .values({ sourceId: s.id, status: "pending" })
      .onConflictDoNothing();
  }

  console.log("seed complete ✓");
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
