/**
 * W7 read-budget baseline harness (FIX-W7 P1).
 *
 * Measures the pre-optimization read cost of the clustering hot paths so the
 * post-fix run-rate can be compared against a real number, and confirms (via
 * EXPLAIN QUERY PLAN) that the Stage A / A.5 nearest-neighbour queries do a
 * FULL SCAN of their time window today. EXPLAIN QUERY PLAN does not execute the
 * query, so the plan probes read ~0 rows; only the COUNT()s below touch data,
 * and they are bounded/one-shot.
 *
 * Run: bun --env-file=.env.local scripts/ops/w7-baseline.ts
 * (Optionally `set -a; source ~/.claude/turso.env; set +a` first to include the
 *  Turso billing snapshot — needs TURSO_API_TOKEN; the script skips it if absent.)
 */
import { closeDb, libsqlClient } from "@/db/client";

const WINDOW_HOURS = 72;
const WINDOW_MS = WINDOW_HOURS * 3_600_000;

type Row = Record<string, unknown>;

async function explain(
  client: ReturnType<typeof libsqlClient>,
  label: string,
  sql: string,
  args: unknown[],
) {
  try {
    const res = await client.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args });
    const plan = res.rows
      .map((r) => String((r as Row).detail ?? Object.values(r).join(" ")))
      .join("\n    ");
    const fullScan = /SCAN (?:TABLE )?items\b/i.test(plan);
    console.log(`\n[${label}] ${fullScan ? "⚠️ FULL SCAN" : "index-assisted"}`);
    console.log(`    ${plan}`);
  } catch (err) {
    console.log(`\n[${label}] EXPLAIN failed: ${(err as Error).message}`);
  }
}

async function scalar(
  client: ReturnType<typeof libsqlClient>,
  sql: string,
  args: unknown[] = [],
): Promise<number> {
  const res = await client.execute({ sql, args });
  return Number(Object.values(res.rows[0] ?? { n: 0 })[0] ?? 0);
}

async function billingSnapshot() {
  const token = process.env.TURSO_API_TOKEN;
  const org = process.env.TURSO_ORG ?? "xingfanxia";
  if (!token) {
    console.log("\n[billing] skipped (no TURSO_API_TOKEN in env)");
    return;
  }
  try {
    const res = await fetch(
      `https://api.turso.tech/v1/organizations/${org}/usage`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const j = (await res.json()) as { total?: Record<string, number> };
    const t = j.total ?? {};
    console.log("\n[billing snapshot — cumulative this cycle]");
    console.log(`    rows_read    = ${t.rows_read?.toLocaleString() ?? "?"}`);
    console.log(`    rows_written = ${t.rows_written?.toLocaleString() ?? "?"}`);
    console.log(
      `    (500M free cap = ${(((t.rows_read ?? 0) / 500_000_000) * 100).toFixed(1)}% ; ` +
        `NOTE: cumulative includes the migration-day flood — use the DELTA between ` +
        `two runs for the steady-state rate.)`,
    );
  } catch (err) {
    console.log(`\n[billing] fetch failed: ${(err as Error).message}`);
  }
}

async function main() {
  const client = libsqlClient();

  // A representative recent enriched item to anchor the window probes.
  const sample = await client.execute({
    sql: `SELECT id, published_at, cluster_id FROM items
          WHERE embedding IS NOT NULL AND enriched_at IS NOT NULL
          ORDER BY published_at DESC LIMIT 1`,
    args: [],
  });
  const s = sample.rows[0] as Row | undefined;
  if (!s) {
    console.log("no enriched item found — cannot probe");
    return;
  }
  const itemId = Number(s.id);
  const publishedAt = Number(s.published_at);
  console.log(`Anchor item id=${itemId} published_at=${publishedAt}`);

  // ── Corpus counts ──────────────────────────────────────────────────────────
  const totalEnriched = await scalar(
    client,
    `SELECT count(*) FROM items WHERE embedding IS NOT NULL AND enriched_at IS NOT NULL`,
  );
  const clustered = await scalar(
    client,
    `SELECT count(*) FROM items WHERE cluster_id IS NOT NULL AND embedding IS NOT NULL`,
  );
  const singletons = await scalar(
    client,
    `SELECT count(*) FROM clusters WHERE member_count = 1`,
  );
  const totalClusters = await scalar(client, `SELECT count(*) FROM clusters`);
  const windowPop = await scalar(
    client,
    `SELECT count(*) FROM items
     WHERE embedding IS NOT NULL AND enriched_at IS NOT NULL
       AND published_at BETWEEN ? AND ?`,
    [publishedAt - WINDOW_MS, publishedAt + WINDOW_MS],
  );

  console.log("\n[corpus]");
  console.log(`    enriched items (embedding present) = ${totalEnriched}`);
  console.log(`    clustered items                    = ${clustered}`);
  console.log(`    singleton clusters                 = ${singletons}`);
  console.log(`    total clusters                     = ${totalClusters}`);
  console.log(`    items in ±${WINDOW_HOURS}h window of anchor    = ${windowPop}`);
  console.log(
    `    → each Stage A/A.5 NN probe scans ~${windowPop} rows today; A.5 does` +
      ` this for EACH of ~${singletons} singletons per tick.`,
  );

  // ── EXPLAIN the hot NN queries (does NOT execute — ~0 rows read) ────────────
  const clusteredNN = `
    WITH target AS (SELECT embedding, published_at FROM items WHERE id = ?)
    SELECT i.id, i.cluster_id,
           vector_distance_cos(i.embedding, (SELECT embedding FROM target)) AS distance
    FROM items i
    WHERE i.id <> ? AND i.embedding IS NOT NULL AND i.enriched_at IS NOT NULL
      AND i.cluster_id IS NOT NULL
      AND i.published_at BETWEEN (SELECT published_at FROM target) - ?
                             AND (SELECT published_at FROM target) + ?
    ORDER BY vector_distance_cos(i.embedding, (SELECT embedding FROM target))
    LIMIT 1`;
  await explain(client, "Stage A — nearest CLUSTERED neighbour", clusteredNN, [
    itemId,
    itemId,
    WINDOW_MS,
    WINDOW_MS,
  ]);

  const unclusteredNN = clusteredNN.replace(
    "i.cluster_id IS NOT NULL",
    "i.cluster_id IS NULL",
  );
  await explain(
    client,
    "Stage A — nearest UNCLUSTERED neighbour",
    unclusteredNN,
    [itemId, itemId, WINDOW_MS, WINDOW_MS],
  );

  // The ANN replacement we will ship (proves the index CAN serve it).
  const annProbe = `SELECT id FROM vector_top_k('items_embedding_small_idx',
                      (SELECT embedding_small FROM items WHERE id = ?), 500)`;
  await explain(client, "ANN candidate probe (target design)", annProbe, [
    itemId,
  ]);

  await billingSnapshot();
  console.log("\nDone. Re-run after any pipeline activity to measure the delta.");
}

if (import.meta.main) {
  main()
    .catch((err: unknown) => {
      console.error("w7-baseline failed:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
