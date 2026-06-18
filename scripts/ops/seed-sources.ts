/**
 * One-shot seed script: reconcile `sources` + `source_health` against
 * lib/sources/catalog.ts.
 *
 * Safe to re-run: catalog rows are upserted; enabled rows no longer present in
 * the catalog are disabled so stale DB-only sources cannot keep showing up as
 * fetch-pending cron work.
 *
 * Usage:
 *   bun run db:seed
 * or:
 *   bun scripts/ops/seed-sources.ts
 */

import { closeDb, db } from "@/db/client";
import { sources, sourceHealth } from "@/db/schema";
import { sourceCatalog } from "@/lib/sources/catalog";
import type { Source } from "@/lib/types";
import { and, eq, notInArray, sql } from "drizzle-orm";

type DbClient = ReturnType<typeof db>;

export const CATALOG_ORPHAN_SOURCE_NOTE =
  "Disabled by db:seed because lib/sources/catalog.ts no longer defines this source.";

export type SeedSourcesReport = {
  seeded: number;
  disabledOrphans: string[];
};

export function sourceCatalogIds(
  catalog: readonly Pick<Source, "id">[] = sourceCatalog,
): string[] {
  return catalog.map((s) => s.id);
}

export function duplicateSourceCatalogIds(
  catalog: readonly Pick<Source, "id">[] = sourceCatalog,
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const id of sourceCatalogIds(catalog)) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }

  return [...duplicates].sort();
}

function assertUniqueSourceCatalogIds(
  catalog: readonly Pick<Source, "id">[] = sourceCatalog,
): void {
  const duplicates = duplicateSourceCatalogIds(catalog);
  if (duplicates.length > 0) {
    throw new Error(`duplicate source catalog ids: ${duplicates.join(", ")}`);
  }
}

async function upsertCatalogSource(client: DbClient, s: Source): Promise<void> {
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
      curated: s.curated ?? false,
      neverExclude: s.neverExclude ?? false,
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
        curated: sql`EXCLUDED.curated`,
        neverExclude: sql`EXCLUDED.never_exclude`,
        updatedAt: sql`now()`,
      },
    });

  await client
    .insert(sourceHealth)
    .values({ sourceId: s.id, status: "pending" })
    .onConflictDoNothing();
}

export async function disableCatalogOrphanSources(
  client: DbClient,
  catalogIds = sourceCatalogIds(),
): Promise<string[]> {
  if (catalogIds.length === 0) {
    throw new Error("refusing to disable sources with an empty source catalog");
  }

  const disabled = await client
    .update(sources)
    .set({
      enabled: false,
      notes: sql<string>`CASE
        WHEN ${sources.notes} IS NULL OR ${sources.notes} = '' THEN ${CATALOG_ORPHAN_SOURCE_NOTE}::text
        ELSE ${sources.notes} || chr(10) || ${CATALOG_ORPHAN_SOURCE_NOTE}::text
      END`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(sources.enabled, true), notInArray(sources.id, catalogIds)))
    .returning({ id: sources.id });

  return disabled.map((row) => row.id);
}

export async function seedSources(client: DbClient = db()): Promise<SeedSourcesReport> {
  assertUniqueSourceCatalogIds();

  for (const s of sourceCatalog) {
    await upsertCatalogSource(client, s);
  }

  return {
    seeded: sourceCatalog.length,
    disabledOrphans: await disableCatalogOrphanSources(client),
  };
}

async function main() {
  console.log(`seeding ${sourceCatalog.length} sources...`);

  const report = await seedSources();
  if (report.disabledOrphans.length > 0) {
    console.log(
      `disabled catalog-orphan source rows: ${report.disabledOrphans.join(", ")}`,
    );
  }

  console.log("seed complete");
}

if (import.meta.main) {
  main()
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("seed failed:", msg);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
