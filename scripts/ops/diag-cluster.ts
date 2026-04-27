/**
 * Inspect cluster contents — dump member titles, sources, and timestamps for
 * a list of cluster IDs. Used to spot-check before/after a backfill merge,
 * audit Stage B "keep" verdicts, and confirm cluster-membership in incident
 * response. Read-only.
 *
 * Usage: bun run scripts/ops/diag-cluster.ts 13107 21485 21521
 */
import { sql } from "drizzle-orm";
import { db, closeDb } from "@/db/client";

const ids = process.argv
  .slice(2)
  .map((s) => Number.parseInt(s, 10))
  .filter((n) => Number.isFinite(n));

if (ids.length === 0) {
  console.error("usage: diag-cluster.ts <cluster_id> [<cluster_id> ...]");
  process.exit(1);
}

const client = db();

for (const cid of ids) {
  const cluster = (await client.execute(sql`
    SELECT id, member_count, first_seen_at, latest_member_at, canonical_title_zh, canonical_title_en
    FROM clusters WHERE id = ${cid}
  `)) as unknown as Array<{
    id: number;
    member_count: number;
    first_seen_at: string;
    latest_member_at: string | null;
    canonical_title_zh: string | null;
    canonical_title_en: string | null;
  }>;
  if (cluster.length === 0) {
    console.log(`cluster ${cid}: NOT FOUND\n`);
    continue;
  }
  const c = cluster[0];
  console.log(
    `Cluster ${c.id} (${c.member_count} members) firstSeen=${c.first_seen_at} latest=${c.latest_member_at}`,
  );
  if (c.canonical_title_zh) console.log(`  title_zh: ${c.canonical_title_zh}`);
  if (c.canonical_title_en) console.log(`  title_en: ${c.canonical_title_en}`);

  const members = (await client.execute(sql`
    SELECT i.id, i.title, i.title_zh, i.published_at, s.name_en AS source
    FROM items i JOIN sources s ON s.id = i.source_id
    WHERE i.cluster_id = ${cid}
    ORDER BY i.published_at ASC
  `)) as unknown as Array<{
    id: number;
    title: string;
    title_zh: string | null;
    published_at: string;
    source: string;
  }>;

  for (const m of members) {
    console.log(`  [${m.id}] ${m.published_at} ${m.source}`);
    console.log(`        ${m.title_zh ?? m.title}`);
  }
  console.log();
}

await closeDb();
