/**
 * One-time DB init: enable pgvector extension (needed for halfvec).
 * Safe to re-run — uses IF NOT EXISTS.
 *
 * Run before db:push when adding embedding/vector columns.
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
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    const ver = await sql<
      { extversion: string }[]
    >`SELECT extversion FROM pg_extension WHERE extname='vector'`;
    console.log(`✓ pgvector v${ver[0]?.extversion} ready`);
  } finally {
    await sql.end({ timeout: 3 });
  }
}

main();
