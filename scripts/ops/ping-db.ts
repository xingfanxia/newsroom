import { closeDb, libsqlClient } from "@/db/client";

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("No TURSO_DATABASE_URL set");
    process.exit(2);
  }

  console.log(
    `connecting to ${process.env.TURSO_DATABASE_URL.slice(0, 60)}...`,
  );

  try {
    const client = libsqlClient();
    const rows = await client.execute(
      "SELECT 1 AS ok, sqlite_version() AS version",
    );
    console.log("✓ connected");
    console.log(JSON.stringify(rows.rows[0], null, 2));

    const vec = await client.execute(
      "SELECT name FROM sqlite_master WHERE name = 'items_embedding_small_idx'",
    );
    console.log(
      "vector index:",
      vec.rows.length > 0
        ? "items_embedding_small_idx ✓"
        : "MISSING — run scripts/ops/backfill-embedding-small.ts",
    );
  } catch (err) {
    console.error("✗ failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main();
