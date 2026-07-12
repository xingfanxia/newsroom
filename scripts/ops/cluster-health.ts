/**
 * Cluster-subsystem health check — read-only diagnostics over the live DB.
 *
 * Covers the invariants the cluster pipeline is supposed to maintain:
 *   1. size distribution + singleton rate
 *   2. member_count / coverage drift vs actual COUNT(items)
 *   3. dangling lead_item_id (lead not a member of its own cluster)
 *   4. untitled multi-member clusters (merge-stage NULL-title exclusion)
 *   5. cluster_splits volume + items at the rejection cap
 *   6. arbitration backlog (unverified multi-member clusters)
 *   7. verified-singleton lock (split down to 1 member, never re-checked)
 *   8. remaining near-duplicate cluster pairs (merge-shape query, recent window)
 *   9. worst intra-cluster cohesion (possible bad merges)
 *  10. singleton pairs >72h apart that look like the same event (window recall gap)
 *
 * Usage: bun --env-file=.env.local scripts/ops/cluster-health.ts [--days 14]
 *        add --repair to preview the reconcile pass (dry-run), --repair --apply
 *        to actually recompute drifted aggregates / re-point dangling leads /
 *        delete 0-member clusters. Without --repair the script is read-only.
 */
import { sql } from "drizzle-orm";
import { db, closeDb } from "@/db/client";
import { reconcileClusters } from "@/workers/cluster/reconcile";

const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg >= 0 ? Number(process.argv[daysArg + 1]) : 14;
const sinceMs = Date.now() - DAYS * 86_400_000;

const client = db();

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

// 1. Size distribution
section("1. cluster size distribution (all time)");
const dist = await client.all<{ bucket: string; clusters: number; items: number }>(sql`
  SELECT CASE
      WHEN member_count = 1 THEN '1 (singleton)'
      WHEN member_count = 2 THEN '2'
      WHEN member_count BETWEEN 3 AND 5 THEN '3-5'
      WHEN member_count BETWEEN 6 AND 10 THEN '6-10'
      ELSE '11+' END AS bucket,
    count(*) AS clusters,
    sum(member_count) AS items
  FROM clusters GROUP BY 1 ORDER BY min(member_count)
`);
for (const r of dist) console.log(`  ${r.bucket.padEnd(14)} ${String(r.clusters).padStart(6)} clusters  ${String(r.items).padStart(6)} items`);
const tot = await client.all<{ c: number; s: number }>(sql`
  SELECT count(*) AS c, sum(member_count = 1) AS s FROM clusters
`);
console.log(`  singleton rate: ${tot[0].s}/${tot[0].c} = ${((100 * tot[0].s) / tot[0].c).toFixed(1)}%`);

// 2. member_count / coverage drift
section("2. member_count & coverage drift vs actual");
const drift = await client.all<{ n: number }>(sql`
  SELECT count(*) AS n FROM (
    SELECT c.id FROM clusters c
    LEFT JOIN items i ON i.cluster_id = c.id
    GROUP BY c.id, c.member_count
    HAVING c.member_count <> count(i.id)
  )
`);
console.log(`  clusters where member_count <> COUNT(items): ${drift[0].n}`);
const covDrift = await client.all<{ n: number }>(sql`
  SELECT count(*) AS n FROM clusters WHERE coverage IS NOT NULL AND coverage <> member_count
`);
console.log(`  clusters where coverage <> member_count:     ${covDrift[0].n}`);
const zombies = await client.all<{ n: number }>(sql`
  SELECT count(*) AS n FROM clusters WHERE member_count = 0
`);
console.log(`  zombie clusters (member_count = 0):          ${zombies[0].n}`);

// 3. dangling leads
section("3. dangling lead_item_id");
const dangling = await client.all<{ n: number }>(sql`
  SELECT count(*) AS n FROM clusters c
  WHERE NOT EXISTS (
    SELECT 1 FROM items i WHERE i.id = c.lead_item_id AND i.cluster_id = c.id
  )
`);
console.log(`  clusters whose lead is NOT one of its members: ${dangling[0].n}`);

// 4. untitled multi-member clusters (merge-stage NULL exclusion blast radius)
section("4. canonical-title coverage on multi-member clusters");
const titled = await client.all<{ total: number; untitled: number; recent_untitled: number }>(sql`
  SELECT count(*) AS total,
    sum(canonical_title_zh IS NULL AND canonical_title_en IS NULL) AS untitled,
    sum(CASE WHEN canonical_title_zh IS NULL AND canonical_title_en IS NULL
         AND latest_member_at > ${sinceMs} THEN 1 ELSE 0 END) AS recent_untitled
  FROM clusters WHERE member_count >= 2
`);
console.log(`  multi-member clusters: ${titled[0].total}, untitled: ${titled[0].untitled} (last ${DAYS}d: ${titled[0].recent_untitled})`);
console.log(`  (untitled clusters are silently EXCLUDED from the merge stage — NOT NULL-title bug)`);

// 5. split audit
section("5. cluster_splits (Stage B rejections)");
const splits = await client.all<{ total: number; items: number; capped: number }>(sql`
  SELECT count(*) AS total, count(DISTINCT item_id) AS items,
    (SELECT count(*) FROM (
      SELECT item_id FROM cluster_splits GROUP BY item_id
      HAVING count(DISTINCT from_cluster_id) >= 3
    )) AS capped
  FROM cluster_splits
`);
console.log(`  split rows: ${splits[0].total}, distinct items: ${splits[0].items}, items at rejection cap (>=3): ${splits[0].capped}`);

// 6. arbitration backlog
section("6. arbitration backlog (unverified multi-member clusters)");
const backlog = await client.all<{ n: number; recent: number }>(sql`
  SELECT count(*) AS n,
    sum(CASE WHEN latest_member_at > ${sinceMs} THEN 1 ELSE 0 END) AS recent
  FROM clusters c
  WHERE member_count >= 2
    AND (verified_at IS NULL OR EXISTS (
      SELECT 1 FROM items i WHERE i.cluster_id = c.id AND i.cluster_verified_at IS NULL))
`);
console.log(`  clusters awaiting arbitration: ${backlog[0].n} (last ${DAYS}d: ${backlog[0].recent}); cron cap = 15/run`);

// 7. verified-singleton lock
section("7. verified singletons (locked out of A.5 recluster)");
const lockedSingles = await client.all<{ n: number }>(sql`
  SELECT count(*) AS n FROM clusters c
  JOIN items i ON i.cluster_id = c.id
  WHERE c.member_count = 1 AND i.cluster_verified_at IS NOT NULL
`);
console.log(`  member_count=1 with cluster_verified_at set: ${lockedSingles[0].n}`);

// 8. remaining near-duplicate cluster pairs, last N days (merge-shape query,
//    with the NULL-title exclusion REMOVED so we see the true residue)
section(`8. near-duplicate multi-member cluster pairs (last ${DAYS}d, corrected predicate)`);
const pairs = await client.all<{
  a: number; b: number; ta: string | null; tb: string | null;
  min_d: number; mean_d: number; pw: number; tp: number;
}>(sql`
  WITH multi AS (
    SELECT c.id, c.member_count, COALESCE(c.canonical_title_zh, c.canonical_title_en) AS t
    FROM clusters c
    WHERE c.member_count >= 2 AND c.latest_member_at > ${sinceMs}
  ),
  pair_distances AS (
    SELECT a.id AS a, b.id AS b, a.t AS ta, b.t AS tb,
      MIN(vector_distance_cos(ia.embedding, ib.embedding)) AS min_d,
      AVG(vector_distance_cos(ia.embedding, ib.embedding)) AS mean_d,
      SUM(CASE WHEN vector_distance_cos(ia.embedding, ib.embedding) <= 0.25 THEN 1 ELSE 0 END) AS pw,
      COUNT(*) AS tp
    FROM multi a JOIN multi b ON a.id < b.id
    JOIN items ia ON ia.cluster_id = a.id AND ia.embedding IS NOT NULL
    JOIN items ib ON ib.cluster_id = b.id AND ib.embedding IS NOT NULL
    WHERE ABS(ia.published_at - ib.published_at) <= 259200000
    GROUP BY a.id, b.id
  )
  SELECT * FROM pair_distances
  WHERE min_d <= 0.25 AND mean_d <= 0.20 AND (CAST(pw AS REAL) / tp) >= 0.5
  ORDER BY mean_d ASC LIMIT 20
`);
console.log(`  merge-eligible pairs still unmerged: ${pairs.length}${pairs.length === 20 ? "+ (capped)" : ""}`);
for (const p of pairs.slice(0, 10)) {
  console.log(`  [${p.a} ~ ${p.b}] mean=${p.mean_d.toFixed(3)} min=${p.min_d.toFixed(3)} within=${p.pw}/${p.tp}`);
  console.log(`     A: ${(p.ta ?? "(untitled)").slice(0, 60)}`);
  console.log(`     B: ${(p.tb ?? "(untitled)").slice(0, 60)}`);
}

// 9. worst intra-cluster cohesion (recent multi clusters)
section(`9. worst intra-cluster cohesion (last ${DAYS}d) — possible bad merges`);
const cohesion = await client.all<{
  id: number; mc: number; t: string | null; max_d: number; mean_d: number;
}>(sql`
  SELECT c.id, c.member_count AS mc,
    COALESCE(c.canonical_title_zh, c.canonical_title_en) AS t,
    MAX(vector_distance_cos(ia.embedding, ib.embedding)) AS max_d,
    AVG(vector_distance_cos(ia.embedding, ib.embedding)) AS mean_d
  FROM clusters c
  JOIN items ia ON ia.cluster_id = c.id AND ia.embedding IS NOT NULL
  JOIN items ib ON ib.cluster_id = c.id AND ib.embedding IS NOT NULL AND ia.id < ib.id
  WHERE c.member_count >= 2 AND c.latest_member_at > ${sinceMs}
  GROUP BY c.id
  ORDER BY max_d DESC LIMIT 10
`);
for (const r of cohesion) {
  console.log(`  cluster ${r.id} (${r.mc} members) max=${r.max_d.toFixed(3)} mean=${r.mean_d.toFixed(3)}  ${(r.t ?? "(untitled)").slice(0, 55)}`);
}

// 10. singleton twins separated by >72h (Stage A window recall gap)
section(`10. singleton pairs that look same-event but sit >72h apart (last ${DAYS}d)`);
const gapTwins = await client.all<{
  a: number; b: number; d: number; gap_h: number; ta: string; tb: string;
}>(sql`
  WITH singles AS (
    SELECT i.id, i.embedding, i.published_at,
      SUBSTR(COALESCE(i.title_zh, i.title), 1, 60) AS t
    FROM items i JOIN clusters c ON i.cluster_id = c.id
    WHERE c.member_count = 1 AND i.embedding IS NOT NULL
      AND i.published_at > ${sinceMs}
  )
  SELECT a.id AS a, b.id AS b,
    vector_distance_cos(a.embedding, b.embedding) AS d,
    CAST((b.published_at - a.published_at) / 3600000.0 AS INTEGER) AS gap_h,
    a.t AS ta, b.t AS tb
  FROM singles a JOIN singles b
    ON a.id < b.id AND b.published_at - a.published_at > 259200000
  WHERE vector_distance_cos(a.embedding, b.embedding) <= 0.20
  ORDER BY d ASC LIMIT 10
`);
console.log(`  pairs found: ${gapTwins.length}${gapTwins.length === 10 ? "+ (capped)" : ""}`);
for (const p of gapTwins) {
  console.log(`  [${p.a} ~ ${p.b}] d=${p.d.toFixed(3)} gap=${p.gap_h}h`);
  console.log(`     A: ${p.ta}`);
  console.log(`     B: ${p.tb}`);
}

// 11. Optional reconcile pass. Read-only unless --repair is passed; --repair
//     alone previews (dry-run), --repair --apply writes. Idempotent: a second
//     --apply over clean data reports 0 changes.
if (process.argv.includes("--repair")) {
  const apply = process.argv.includes("--apply");
  section(`11. reconcile pass (${apply ? "APPLY" : "dry-run — add --apply to write"})`);
  const rep = await reconcileClusters({ apply });
  console.log(`  aggregates ${apply ? "fixed" : "to fix"}:          ${rep.aggregatesFixed}`);
  console.log(`  zombies ${apply ? "deleted" : "to delete"}:        ${rep.zombiesDeleted}`);
  console.log(`  dangling leads ${apply ? "repointed" : "to repoint"}: ${rep.leadsRepointed}`);
  const total = rep.aggregatesFixed + rep.zombiesDeleted + rep.leadsRepointed;
  if (!apply && total > 0) console.log(`  → re-run with '--repair --apply' to fix.`);
  if (apply && total > 0) console.log(`  ⚠ ALARM: reconcile applied ${total} fix(es) — drift should not accrue; investigate the source.`);
}

await closeDb();
console.log("\nCLUSTER HEALTH CHECK DONE");
