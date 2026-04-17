import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * Postgres connection for AX's AI RADAR.
 *
 * Works with any Postgres + pgvector (Supabase / Railway / self-hosted).
 * On Supabase (via Vercel Marketplace), these env vars are auto-wired:
 *   POSTGRES_URL              — pooled connection (port 6543, PgBouncer transaction mode)
 *   POSTGRES_URL_NON_POOLING  — direct connection (port 5432, for migrations / long tx)
 *
 * Runtime uses the pooled URL with `prepare: false` because PgBouncer's
 * transaction mode does not support prepared statements.
 */
function resolveRuntimeUrl() {
  const url =
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_PRISMA_URL;
  if (!url) {
    throw new Error(
      "POSTGRES_URL is not set. Link Supabase via Vercel Marketplace, or set DATABASE_URL manually.",
    );
  }
  return url;
}

let cachedSql: ReturnType<typeof postgres> | null = null;
let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (!cachedDb) {
    cachedSql = postgres(resolveRuntimeUrl(), {
      // PgBouncer transaction mode — no prepared statements across tx boundaries.
      prepare: false,
      // Allow parallel queries per invocation. With max:1 a Promise.all of
      // 6 stats queries deadlocked and hit statement_timeout (the admin/system
      // page). PgBouncer handles fan-in on its side; each query grabs a
      // short-lived pooler connection and releases on tx end.
      max: 10,
      // Quick idle release so hot invocations don't hoard connections.
      idle_timeout: 20,
      // Connection timeout in seconds.
      connect_timeout: 10,
      // Don't crash the process on pool errors — surface via throw.
      onnotice: () => {},
    });
    cachedDb = drizzle(cachedSql, { schema, casing: "snake_case" });
  }
  return cachedDb;
}

/** Close the underlying pool — used by scripts that need a clean exit. */
export async function closeDb() {
  if (cachedSql) {
    await cachedSql.end({ timeout: 5 });
    cachedSql = null;
    cachedDb = null;
  }
}

export { schema };
