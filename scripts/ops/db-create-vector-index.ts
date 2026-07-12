/**
 * Create the DiskANN candidate index on items.embedding_small (Matryoshka
 * 256-dim) for fast cosine nearest-neighbor candidate generation.
 *
 * NOT on the full 3072-dim column: DiskANN insert cost scales with dims and
 * measured ~6s/row on Turso — a bulk build wedges the DB write path for
 * hours (killed the first newsroom DB). The 256-dim partial index is cheap
 * and final ranking re-scores candidates with the FULL vector anyway
 * (lib/items/semantic-search.ts).
 *
 * Idempotent. Rerun after any `db:push` (drizzle-kit can't express it).
 * If the index was dropped with data present, prefer running
 * scripts/ops/backfill-embedding-small.ts instead — it recreates the index
 * empty and feeds it incrementally, avoiding a bulk build.
 */
import { closeDb, libsqlClient } from "@/db/client";

async function main() {
  const client = libsqlClient();
  await client.execute(`
    CREATE INDEX IF NOT EXISTS items_embedding_small_idx
    ON items (
      libsql_vector_idx(
        embedding_small,
        'metric=cosine',
        'compress_neighbors=float8',
        'max_neighbors=20'
      )
    )
    WHERE embedding_small IS NOT NULL
  `);
  console.log("✓ DiskANN index created / verified on items.embedding_small");
  await closeDb();
}

main().catch((e) => {
  console.error("✗ failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
