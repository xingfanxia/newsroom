/**
 * Create the DiskANN vector index on items.embedding for fast cosine
 * nearest-neighbor search (libSQL native vectors — replaced pgvector HNSW).
 *
 * Why separate from schema push: drizzle-kit can't emit
 * `libsql_vector_idx(...)` syntax. Run this idempotently after any db:push
 * (mirror of the old db-create-hnsw.ts flow).
 *
 * Settings (see turso.tech vector docs; 3072-dim vectors make the DEFAULT
 * index enormous — every node stores ~3·√D ≈ 166 neighbor copies):
 *   compress_neighbors=float8 — 4× smaller neighbor copies, negligible recall
 *   max_neighbors=40          — plenty for a ~20k-row corpus
 *   partial WHERE             — only rows that actually have embeddings
 */
import { closeDb, libsqlClient } from "@/db/client";

async function main() {
  const client = libsqlClient();
  await client.execute(`
    CREATE INDEX IF NOT EXISTS items_embedding_idx
    ON items (
      libsql_vector_idx(
        embedding,
        'metric=cosine',
        'compress_neighbors=float8',
        'max_neighbors=40'
      )
    )
    WHERE embedding IS NOT NULL
  `);
  console.log("✓ DiskANN index created / verified on items.embedding");
  await closeDb();
}

main().catch((e) => {
  console.error("✗ failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
