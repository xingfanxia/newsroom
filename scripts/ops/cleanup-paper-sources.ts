#!/usr/bin/env bun
/**
 * Remove retired research-paper sources and their historical items. Also removes
 * paper-category items that arrived through mixed sources such as AI HOT.
 *
 * Default is dry-run. Apply only after checking the source and item counts:
 *   bun --env-file=.env.local scripts/ops/cleanup-paper-sources.ts
 *   bun --env-file=.env.local scripts/ops/cleanup-paper-sources.ts --apply
 */
import { sql } from "drizzle-orm";
import { db, closeDb } from "@/db/client";

const PAPER_SOURCE_IDS = [
  "arxiv-cs-ai",
  "arxiv-cs-cl",
  "arxiv-cs-lg",
  "huggingface-papers",
  "paperswithcode",
  "hf-papers-takara",
] as const;

const PAPER_SOURCE_TAGS = ["arxiv", "paper"] as const;
const MIXED_PAPER_SOURCE_IDS = ["aihot-selected", "aihot-all"] as const;

type Args = {
  dryRun: boolean;
};

const DEFAULT_ARGS: Args = { dryRun: true };

type SourceRow = {
  id: string;
  name_en: string;
  tags: string[];
  raw_items: number;
  items: number;
};

type CountsRow = {
  sources: number;
  raw_items: number;
  items: number;
  affected_clusters: number;
  paper_only_clusters: number;
  mixed_clusters: number;
};

type PostRow = {
  remaining_sources: number;
  remaining_raw_items: number;
  remaining_items: number;
  remaining_clusters: number;
};

function parseArgs(argv: string[]): Args {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`Usage:
  bun --env-file=.env.local scripts/ops/cleanup-paper-sources.ts
  bun --env-file=.env.local scripts/ops/cleanup-paper-sources.ts --apply

Options:
  --apply   perform the cleanup. Omitted means dry-run.
`);
    process.exit(0);
  }

  return argv.includes("--apply") ? { dryRun: false } : DEFAULT_ARGS;
}

function sourceIdList() {
  return sql.join(
    PAPER_SOURCE_IDS.map((id) => sql`${id}`),
    sql`, `,
  );
}

function sourceTagArray() {
  return sql`ARRAY[${sql.join(
    PAPER_SOURCE_TAGS.map((tag) => sql`${tag}`),
    sql`, `,
  )}]::text[]`;
}

function mixedPaperSourceIdList() {
  return sql.join(
    MIXED_PAPER_SOURCE_IDS.map((id) => sql`${id}`),
    sql`, `,
  );
}

function targetSourceWhere() {
  return sql`(s.id IN (${sourceIdList()}) OR s.tags && ${sourceTagArray()})`;
}

async function listTargetSources(): Promise<SourceRow[]> {
  return (await db().execute(sql`
    SELECT
      s.id,
      s.name_en,
      s.tags,
      (
        SELECT count(*)::int
        FROM raw_items r
        WHERE r.source_id = s.id
      ) AS raw_items,
      (
        SELECT count(*)::int
        FROM items i
        WHERE i.source_id = s.id
      ) AS items
    FROM sources s
    WHERE ${targetSourceWhere()}
    ORDER BY s.id
  `)) as unknown as SourceRow[];
}

async function getPreflightCounts(): Promise<CountsRow> {
  const rows = (await db().execute(sql`
    WITH target_sources AS (
      SELECT s.id
      FROM sources s
      WHERE ${targetSourceWhere()}
    ),
    target_raw_items AS (
      SELECT r.id
      FROM raw_items r
      WHERE r.source_id IN (SELECT id FROM target_sources)
         OR (
           r.source_id IN (${mixedPaperSourceIdList()})
           AND r.raw_payload->>'category' = 'paper'
         )
    ),
    target_items AS (
      SELECT i.id, i.cluster_id
      FROM items i
      JOIN target_raw_items tri ON tri.id = i.raw_item_id
    ),
    affected_clusters AS (
      SELECT DISTINCT cluster_id AS id
      FROM target_items
      WHERE cluster_id IS NOT NULL
    ),
    cluster_counts AS (
      SELECT
        ac.id,
        count(i.id) FILTER (WHERE ti.id IS NOT NULL)::int AS paper_items,
        count(i.id) FILTER (WHERE ti.id IS NULL)::int AS kept_items
      FROM affected_clusters ac
      JOIN items i ON i.cluster_id = ac.id
      LEFT JOIN target_items ti ON ti.id = i.id
      GROUP BY ac.id
    )
    SELECT
      (SELECT count(*)::int FROM target_sources) AS sources,
      (SELECT count(*)::int FROM target_raw_items) AS raw_items,
      (SELECT count(*)::int FROM target_items) AS items,
      (SELECT count(*)::int FROM affected_clusters) AS affected_clusters,
      (SELECT count(*)::int FROM cluster_counts WHERE kept_items = 0) AS paper_only_clusters,
      (SELECT count(*)::int FROM cluster_counts WHERE kept_items > 0) AS mixed_clusters
  `)) as unknown as CountsRow[];
  return rows[0] ?? {
    sources: 0,
    raw_items: 0,
    items: 0,
    affected_clusters: 0,
    paper_only_clusters: 0,
    mixed_clusters: 0,
  };
}

async function getPostCounts(): Promise<PostRow> {
  const rows = (await db().execute(sql`
    WITH target_sources AS (
      SELECT s.id
      FROM sources s
      WHERE ${targetSourceWhere()}
    ),
    target_raw_items AS (
      SELECT r.id
      FROM raw_items r
      WHERE r.source_id IN (SELECT id FROM target_sources)
         OR (
           r.source_id IN (${mixedPaperSourceIdList()})
           AND r.raw_payload->>'category' = 'paper'
         )
    )
    SELECT
      (SELECT count(*)::int FROM target_sources) AS remaining_sources,
      (SELECT count(*)::int FROM target_raw_items) AS remaining_raw_items,
      (SELECT count(*)::int FROM items i JOIN target_raw_items tri ON tri.id = i.raw_item_id) AS remaining_items,
      (SELECT count(*)::int FROM clusters c WHERE NOT EXISTS (
        SELECT 1 FROM items i WHERE i.cluster_id = c.id
      )) AS remaining_clusters
  `)) as unknown as PostRow[];
  return rows[0] ?? {
    remaining_sources: 0,
    remaining_raw_items: 0,
    remaining_items: 0,
    remaining_clusters: 0,
  };
}

async function applyCleanup(): Promise<void> {
  const client = db();
  await client.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '600s'`);

    await tx.execute(sql`
      CREATE TEMP TABLE cleanup_paper_sources ON COMMIT DROP AS
      SELECT s.id
      FROM sources s
      WHERE ${targetSourceWhere()}
    `);

    await tx.execute(sql`
      CREATE TEMP TABLE cleanup_paper_raw_items ON COMMIT DROP AS
      SELECT r.id
      FROM raw_items r
      WHERE r.source_id IN (SELECT id FROM cleanup_paper_sources)
         OR (
           r.source_id IN (${mixedPaperSourceIdList()})
           AND r.raw_payload->>'category' = 'paper'
         )
    `);

    await tx.execute(sql`
      CREATE TEMP TABLE affected_clusters ON COMMIT DROP AS
      SELECT DISTINCT i.cluster_id AS id
      FROM items i
      JOIN cleanup_paper_raw_items pri ON pri.id = i.raw_item_id
      WHERE i.cluster_id IS NOT NULL
    `);

    await tx.execute(sql`
      DELETE FROM raw_items
      WHERE id IN (SELECT id FROM cleanup_paper_raw_items)
    `);

    await tx.execute(sql`
      DELETE FROM sources
      WHERE id IN (SELECT id FROM cleanup_paper_sources)
    `);

    await tx.execute(sql`
      DELETE FROM clusters c
      USING affected_clusters ac
      WHERE c.id = ac.id
        AND NOT EXISTS (
          SELECT 1
          FROM items i
          WHERE i.cluster_id = c.id
        )
    `);

    await tx.execute(sql`
      WITH remaining AS (
        SELECT
          i.cluster_id AS id,
          count(*)::int AS member_count,
          min(i.published_at) AS first_seen_at,
          max(i.published_at) AS latest_member_at
        FROM items i
        JOIN affected_clusters ac ON ac.id = i.cluster_id
        GROUP BY i.cluster_id
      ),
      lead AS (
        SELECT id AS cluster_id, item_id
        FROM (
          SELECT
            i.cluster_id AS id,
            i.id AS item_id,
            row_number() OVER (
              PARTITION BY i.cluster_id
              ORDER BY i.importance DESC NULLS LAST, i.published_at DESC, i.id DESC
            ) AS rn
          FROM items i
          JOIN affected_clusters ac ON ac.id = i.cluster_id
        ) ranked
        WHERE rn = 1
      )
      UPDATE clusters c
      SET
        lead_item_id = lead.item_id,
        member_count = remaining.member_count,
        coverage = remaining.member_count,
        first_seen_at = remaining.first_seen_at,
        latest_member_at = remaining.latest_member_at,
        canonical_title_zh = NULL,
        canonical_title_en = NULL,
        titled_at = NULL,
        summary_zh = NULL,
        summary_en = NULL,
        editor_note_zh = NULL,
        editor_note_en = NULL,
        editor_analysis_zh = NULL,
        editor_analysis_en = NULL,
        commentary_at = NULL,
        importance = NULL,
        event_tier = NULL,
        hkr = NULL,
        verified_at = NULL,
        updated_at = now()
      FROM remaining
      JOIN lead ON lead.cluster_id = remaining.id
      WHERE c.id = remaining.id
    `);

    await tx.execute(sql`
      UPDATE items i
      SET cluster_verified_at = NULL
      FROM affected_clusters ac
      WHERE i.cluster_id = ac.id
    `);
  });
}

function printPreflight(sources: SourceRow[], counts: CountsRow, dryRun: boolean) {
  console.log(
    dryRun
      ? "DRY-RUN — no writes"
      : "APPLY — deleting paper sources and paper-category items",
  );
  console.log("\nTarget sources:");
  if (sources.length === 0) {
    console.log("  none");
  } else {
    for (const s of sources) {
      console.log(
        `  ${s.id} (${s.name_en}) tags=[${s.tags.join(",")}] raw=${s.raw_items} items=${s.items}`,
      );
    }
  }
  console.log("\nPreflight counts:");
  console.log(`  sources:             ${counts.sources}`);
  console.log(`  raw_items:           ${counts.raw_items} (source rows + mixed-source paper category)`);
  console.log(`  items:               ${counts.items} (source rows + mixed-source paper category)`);
  console.log(`  affected_clusters:   ${counts.affected_clusters}`);
  console.log(`  paper_only_clusters: ${counts.paper_only_clusters}`);
  console.log(`  mixed_clusters:      ${counts.mixed_clusters}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [sources, counts] = await Promise.all([
    listTargetSources(),
    getPreflightCounts(),
  ]);
  printPreflight(sources, counts, args.dryRun);

  if (args.dryRun) {
    console.log("\nDry-run complete. Re-run with --apply to delete these rows.");
    return;
  }

  await applyCleanup();
  const post = await getPostCounts();
  console.log("\nPost-cleanup:");
  console.log(`  remaining_sources:    ${post.remaining_sources}`);
  console.log(`  remaining_raw_items:  ${post.remaining_raw_items}`);
  console.log(`  remaining_items:      ${post.remaining_items}`);
  console.log(`  empty_clusters_left:  ${post.remaining_clusters}`);
}

void main()
  .catch((err) => {
    console.error("cleanup failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
