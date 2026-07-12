/* One-off: build the DiskANN index on v2 over ws (no HTTP 300s cap). */
import { createClient } from "@libsql/client";
const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
console.log("building index at", new Date().toISOString());
console.time("index build");
await c.execute(`
  CREATE INDEX IF NOT EXISTS items_embedding_idx
  ON items (
    libsql_vector_idx(
      embedding,
      'metric=cosine',
      'compress_neighbors=float8',
      'max_neighbors=20'
    )
  )
  WHERE embedding IS NOT NULL
`);
console.timeEnd("index build");
const tk = await c.execute("SELECT id FROM vector_top_k('items_embedding_idx', (SELECT embedding FROM items WHERE embedding IS NOT NULL ORDER BY id DESC LIMIT 1), 5)");
console.log("top_k check:", tk.rows.map((r) => Number(r.id)));
c.close();
console.log("INDEX DONE");
