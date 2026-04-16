/**
 * Create the HNSW index on items.embedding for fast cosine-similarity search.
 *
 * Why separate from schema push: drizzle-kit can't emit pgvector operator-class
 * syntax (`halfvec_cosine_ops`). We run this idempotently after db:push.
 *
 * Settings:
 *   m = 16            (default, good for most workloads)
 *   ef_construction = 64  (default, balanced build time vs recall)
 *   maintenance_work_mem bumped to 256MB for faster builds
 */
import postgres from "postgres";

async function main() {
  const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!url) {
    console.error("POSTGRES_URL not set");
    process.exit(2);
  }
  const sql = postgres(url, { prepare: false, max: 1, ssl: "require" });
  try {
    // Bump maintenance memory for the duration of this session — makes HNSW builds
    // orders of magnitude faster on even modest item counts.
    await sql`SET maintenance_work_mem = '256MB'`;

    await sql`
      CREATE INDEX IF NOT EXISTS items_embedding_hnsw_idx
      ON items
      USING hnsw (embedding halfvec_cosine_ops)
      WITH (m = 16, ef_construction = 64)
    `;
    console.log("✓ HNSW index created / verified on items.embedding");
  } finally {
    await sql.end({ timeout: 3 });
  }
}

main();
