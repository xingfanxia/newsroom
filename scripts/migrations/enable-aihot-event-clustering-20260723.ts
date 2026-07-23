/**
 * Correct AI HOT's clustering eligibility without running the full source seed.
 *
 * `mode=selected` is a curated collection of individual articles, not one
 * multi-topic digest per item. Keeping the source opted out made same-event
 * coverage render as separate featured/newsletter stories.
 *
 * SAFE BY DEFAULT: read-only unless `--apply` is passed. The update is scoped
 * to the one source row and preserves curated/never_exclude/other source state.
 *
 * Preview:
 *   bun --env-file=.env.local scripts/migrations/enable-aihot-event-clustering-20260723.ts
 * Apply:
 *   bun --env-file=.env.local scripts/migrations/enable-aihot-event-clustering-20260723.ts --apply
 */
import { closeDb, libsqlClient } from "@/db/client";

const SOURCE_ID = "aihot-selected";

async function main() {
  const apply = process.argv.includes("--apply");
  const client = libsqlClient();
  const before = await client.execute({
    sql: `SELECT id, clustering_opt_out, curated, never_exclude, enabled
          FROM sources
          WHERE id = ?`,
    args: [SOURCE_ID],
  });
  const source = before.rows[0];
  if (!source) throw new Error(`source ${SOURCE_ID} does not exist`);

  const eligible = await client.execute({
    sql: `SELECT COUNT(*) AS pending
          FROM items
          WHERE source_id = ?
            AND cluster_id IS NULL
            AND clustered_at IS NULL
            AND embedding IS NOT NULL
            AND enriched_at IS NOT NULL
            AND tier IN ('featured', 'p1', 'all')`,
    args: [SOURCE_ID],
  });

  console.log(
    `${apply ? "APPLY" : "DRY-RUN"} — ${SOURCE_ID}: ` +
      `opt_out=${source.clustering_opt_out}, curated=${source.curated}, ` +
      `never_exclude=${source.never_exclude}, enabled=${source.enabled}`,
  );
  console.log(
    `  ${eligible.rows[0]?.pending ?? 0} currently pending items become ` +
      "eligible for the normal cluster batches",
  );

  if (!apply) {
    console.log("  would set clustering_opt_out=0 (dry-run — no writes)");
    return;
  }

  const result = await client.execute({
    sql: `UPDATE sources
          SET clustering_opt_out = 0,
              updated_at = (strftime('%s', 'now') * 1000)
          WHERE id = ? AND clustering_opt_out != 0`,
    args: [SOURCE_ID],
  });
  console.log(`  updated ${result.rowsAffected} source row(s)`);
}

if (import.meta.main) {
  main()
    .catch((error: unknown) => {
      console.error(
        "enable-aihot-event-clustering failed:",
        error instanceof Error ? error.message : String(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
