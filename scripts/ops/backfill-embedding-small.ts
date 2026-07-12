/**
 * Backfill items.embedding_small (Matryoshka 256-dim) from the full
 * 3072-dim embedding, feeding the DiskANN candidate index incrementally.
 *
 * Idempotent + resumable: only touches rows WHERE embedding IS NOT NULL AND
 * embedding_small IS NULL. Each batched UPDATE inserts into the DiskANN
 * graph; batches are small so prod cron writes interleave instead of
 * queueing behind one giant CREATE INDEX (which is what wedged the first
 * newsroom DB — never bulk-build a vector index on Turso).
 *
 * Also performs one-time setup (idempotent): ALTER TABLE ADD COLUMN +
 * empty partial index creation (instant on 0 matching rows).
 *
 * Run: bun scripts/ops/backfill-embedding-small.ts
 * (Reads are paged; safe to re-run any time, e.g. after a deploy gap.)
 */
import {
  EMBEDDING_SMALL_DIMS,
  embeddingFromDriver,
  embeddingToDriver,
  embeddingToSmall,
} from "@/db/schema";
import { closeDb, libsqlClient } from "@/db/client";

const READ_PAGE = 200; // × 12KB full embeddings ≈ 2.4MB per read
const WRITE_BATCH = 20; // small so each DiskANN feed holds the lock briefly

async function main() {
  const client = libsqlClient();

  const cols = await client.execute("PRAGMA table_info(items)");
  const hasColumn = cols.rows.some((r) => r.name === "embedding_small");
  if (!hasColumn) {
    await client.execute(
      `ALTER TABLE items ADD COLUMN embedding_small F32_BLOB(${EMBEDDING_SMALL_DIMS})`,
    );
    console.log("column added");
  }
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

  const [{ pending }] = (
    await client.execute(
      "SELECT COUNT(*) AS pending FROM items WHERE embedding IS NOT NULL AND embedding_small IS NULL",
    )
  ).rows as unknown as Array<{ pending: number }>;
  console.log(`pending: ${pending}`);

  let done = 0;
  const started = Date.now();
  for (;;) {
    const page = await client.execute(
      `SELECT id, embedding FROM items
       WHERE embedding IS NOT NULL AND embedding_small IS NULL
       ORDER BY id LIMIT ${READ_PAGE}`,
    );
    if (page.rows.length === 0) break;

    const updates = page.rows.map((r) => {
      const full = embeddingFromDriver(r.embedding);
      const small = embeddingToSmall(full);
      return {
        sql: "UPDATE items SET embedding_small = ? WHERE id = ?",
        args: [embeddingToDriver(small), Number(r.id)] as [Buffer, number],
      };
    });
    for (let i = 0; i < updates.length; i += WRITE_BATCH) {
      await client.batch(updates.slice(i, i + WRITE_BATCH), "write");
    }
    done += page.rows.length;
    const rate = done / ((Date.now() - started) / 60_000);
    console.log(
      `  ${done}/${Number(pending)} (${rate.toFixed(0)}/min, ~${Math.ceil((Number(pending) - done) / Math.max(rate, 1))}min left)`,
    );
  }

  const check = await client.execute(
    "SELECT id FROM vector_top_k('items_embedding_small_idx', (SELECT embedding_small FROM items WHERE embedding_small IS NOT NULL LIMIT 1), 3)",
  );
  console.log(
    "vector_top_k sanity:",
    check.rows.map((r) => Number(r.id)),
  );
  await closeDb();
  console.log("BACKFILL DONE");
}

main().catch((e) => {
  console.error("failed:", e);
  process.exit(1);
});
