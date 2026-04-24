#!/usr/bin/env bun
/**
 * Cold-start migration for the event aggregation phase.
 *
 * Promotes existing single-source clusters into first-class events by
 * backfilling event-level fields from member items. Steps mirror DESIGN.md §9
 * and are all idempotent — safe to re-run.
 *
 * Steps:
 *   1. Backfill clusters.latest_member_at = MAX(member.published_at)
 *   2. Backfill clusters.first_seen_at    = MIN(member.published_at) where unset
 *   3. Copy lead-item editorial fields (commentary, hkr, importance, tier,
 *      summaries) → cluster row, but only when cluster commentary is unset
 *   4. Null commentary_at on multi-member clusters so Stage D regenerates with
 *      cross-source context (lead's per-item commentary stays as fallback)
 *   5. Sync coverage = member_count
 *   6. Recompute importance + approximate tier with coverage boost (uses the
 *      same pure function as Stage B so values don't drift)
 *   7. Union HKR axes across all members for multi-member clusters
 *
 * Prerequisites (run first):
 *   bunx drizzle-kit push       # adds the new clusters columns
 *   bun run db:hnsw             # restores HNSW index that drizzle-kit drops
 *
 * Usage:
 *   bun --env-file=.env.local scripts/migrations/events-from-clusters.ts
 *   bun --env-file=.env.local scripts/migrations/events-from-clusters.ts --dry-run
 */
import { eq, sql } from "drizzle-orm";
import { db, closeDb } from "@/db/client";
import { clusters } from "@/db/schema";
import {
  recomputeEventImportance,
  approximateTierForImportance,
  unionHkr,
  type HkrLike,
} from "@/workers/cluster/importance";

type Args = { dryRun: boolean };

function parseArgs(argv: string[]): Args {
  return { dryRun: argv.includes("--dry-run") };
}

type PreFlightRow = {
  total_clusters: number;
  multi_member: number;
  missing_first_seen: number;
  missing_latest_member: number;
  missing_event_commentary: number;
  missing_importance: number;
};

type ClusterMembersRow = {
  id: number;
  members: Array<{ importance: number | null; hkr: HkrLike | null }>;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = db();

  console.log(args.dryRun ? "🔍 DRY RUN — no writes" : "🚀 LIVE MIGRATION");

  const preRows = (await client.execute(sql`
    SELECT
      count(*)::int AS total_clusters,
      count(*) FILTER (WHERE member_count >= 2)::int AS multi_member,
      count(*) FILTER (WHERE first_seen_at IS NULL)::int AS missing_first_seen,
      count(*) FILTER (WHERE latest_member_at IS NULL)::int AS missing_latest_member,
      count(*) FILTER (WHERE editor_note_zh IS NULL)::int AS missing_event_commentary,
      count(*) FILTER (WHERE importance IS NULL)::int AS missing_importance
    FROM clusters
  `)) as unknown as PreFlightRow[];
  const pre = preRows[0];

  console.log("\n=== Pre-flight ===");
  console.log(`  total clusters:           ${pre.total_clusters}`);
  console.log(`  multi-member clusters:    ${pre.multi_member}`);
  console.log(`  missing first_seen_at:    ${pre.missing_first_seen}`);
  console.log(`  missing latest_member_at: ${pre.missing_latest_member}`);
  console.log(`  missing event commentary: ${pre.missing_event_commentary}`);
  console.log(`  missing importance:       ${pre.missing_importance}`);

  if (args.dryRun) {
    console.log("\n(dry run — no writes performed)");
    await closeDb();
    return;
  }

  console.log("\n=== Migration ===");

  // Step 1 — backfill latest_member_at.
  await client.execute(sql`
    UPDATE clusters c
    SET latest_member_at = sub.max_pub
    FROM (
      SELECT cluster_id, MAX(published_at) AS max_pub
      FROM items
      WHERE cluster_id IS NOT NULL
      GROUP BY cluster_id
    ) sub
    WHERE c.id = sub.cluster_id
      AND (c.latest_member_at IS NULL OR c.latest_member_at < sub.max_pub)
  `);
  console.log("  [1] latest_member_at backfilled");

  // Step 2 — backfill first_seen_at where unset.
  await client.execute(sql`
    UPDATE clusters c
    SET first_seen_at = sub.min_pub
    FROM (
      SELECT cluster_id, MIN(published_at) AS min_pub
      FROM items
      WHERE cluster_id IS NOT NULL
      GROUP BY cluster_id
    ) sub
    WHERE c.id = sub.cluster_id
      AND c.first_seen_at IS NULL
  `);
  console.log("  [2] first_seen_at backfilled");

  // Step 3 — copy lead-item editorial fields. Only fills empty cluster fields,
  // so re-running won't trample fresh Stage D output.
  await client.execute(sql`
    UPDATE clusters c
    SET
      editor_note_zh     = i.editor_note_zh,
      editor_note_en     = i.editor_note_en,
      editor_analysis_zh = i.editor_analysis_zh,
      editor_analysis_en = i.editor_analysis_en,
      commentary_at      = i.commentary_at,
      hkr                = i.hkr,
      importance         = i.importance,
      event_tier         = i.tier,
      summary_zh         = COALESCE(c.summary_zh, i.summary_zh),
      summary_en         = COALESCE(c.summary_en, i.summary_en)
    FROM items i
    WHERE i.id = c.lead_item_id
      AND c.editor_note_zh IS NULL
  `);
  console.log("  [3] lead-item editorial fields copied");

  // Step 4 — null commentary_at on multi-member clusters so Stage D can
  // regenerate with cross-source context. Editorial text stays as fallback.
  await client.execute(sql`
    UPDATE clusters
    SET commentary_at = NULL
    WHERE member_count >= 2
      AND commentary_at IS NOT NULL
  `);
  console.log("  [4] multi-member commentary_at nulled (Stage D will regenerate)");

  // Step 5 — sync coverage with member_count.
  await client.execute(sql`
    UPDATE clusters
    SET coverage = member_count
    WHERE coverage IS DISTINCT FROM member_count
  `);
  console.log("  [5] coverage synced with member_count");

  // Step 6 — recompute importance with coverage boost using the canonical
  // pure function. Done in TS so values match exactly what Stage B writes.
  await recomputeAllImportanceAndHkr(client);

  console.log("\n=== Post-flight ===");
  const postRows = (await client.execute(sql`
    SELECT
      count(*)::int AS total_clusters,
      count(*) FILTER (WHERE member_count >= 2)::int AS multi_member,
      count(*) FILTER (WHERE first_seen_at IS NULL)::int AS missing_first_seen,
      count(*) FILTER (WHERE latest_member_at IS NULL)::int AS missing_latest_member,
      count(*) FILTER (WHERE editor_note_zh IS NULL)::int AS missing_event_commentary,
      count(*) FILTER (WHERE importance IS NULL)::int AS missing_importance
    FROM clusters
  `)) as unknown as PreFlightRow[];
  const post = postRows[0];

  console.log(`  total clusters:           ${post.total_clusters}`);
  console.log(`  missing first_seen_at:    ${post.missing_first_seen}`);
  console.log(`  missing latest_member_at: ${post.missing_latest_member}`);
  console.log(`  missing importance:       ${post.missing_importance}`);
  console.log(`  multi-member needing Stage D commentary regen: ${post.multi_member}`);

  await closeDb();
  console.log("\n✓ Migration complete. Stage B/C/D will pick up the rest on the next cron tick.");
}

/**
 * Pull all clusters with their member importance + hkr in one round trip,
 * then recompute event importance, tier, and union-hkr in TS using the
 * canonical pure functions. One UPDATE per cluster keeps individual writes
 * small enough that postgres-js doesn't choke.
 */
async function recomputeAllImportanceAndHkr(
  client: ReturnType<typeof db>,
): Promise<void> {
  const rows = (await client.execute(sql`
    SELECT
      c.id,
      json_agg(json_build_object(
        'importance', i.importance,
        'hkr', i.hkr
      )) AS members
    FROM clusters c
    JOIN items i ON i.cluster_id = c.id
    GROUP BY c.id
  `)) as unknown as ClusterMembersRow[];

  let importanceUpdated = 0;
  let hkrUnioned = 0;

  for (const row of rows) {
    if (!row.members || row.members.length === 0) continue;

    const { importance } = recomputeEventImportance(row.members);
    const eventTier = approximateTierForImportance(importance);

    // Union HKR only for multi-member clusters; singletons keep their item-level hkr.
    const memberHkr = row.members
      .map((m) => m.hkr)
      .filter((h): h is HkrLike => h != null);
    const unionedHkr =
      row.members.length >= 2 && memberHkr.length > 0
        ? unionHkr(memberHkr)
        : null;

    await client
      .update(clusters)
      .set({
        importance,
        eventTier,
        ...(unionedHkr ? { hkr: unionedHkr } : {}),
        updatedAt: new Date(),
      })
      .where(eq(clusters.id, row.id));

    importanceUpdated++;
    if (unionedHkr) hkrUnioned++;
  }

  console.log(`  [6] importance + tier recomputed: ${importanceUpdated} clusters`);
  console.log(`  [7] HKR axes unioned (multi-member): ${hkrUnioned} clusters`);
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  await closeDb();
  process.exit(1);
});
