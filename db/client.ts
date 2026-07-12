import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

/**
 * Turso libSQL connection for AX's AI RADAR (NEWSROOM-TURSO, 2026-07-11 —
 * replaced Supabase Postgres / postgres.js).
 *
 * Env vars:
 *   TURSO_DATABASE_URL — libsql://newsroom-<org>.aws-us-west-2.turso.io
 *   TURSO_AUTH_TOKEN   — database auth token (full-access)
 *
 * The libsql:// scheme is rewritten to https:// so the client speaks
 * stateless HTTP (hrana-over-fetch) instead of a WebSocket — no socket to
 * cold-start, works identically under bun scripts, Next.js on Vercel Fluid
 * Compute, and tests. The client is cached at module scope; Fluid reuses
 * warm instances so this amortizes across invocations. SQLite is
 * single-writer: concurrent UPDATEs from worker fan-outs serialize on the
 * server side (each is sub-ms; the LLM calls around them dominate).
 */
function resolveRuntimeUrl() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is not set. Create a Turso DB and set " +
        "TURSO_DATABASE_URL + TURSO_AUTH_TOKEN.",
    );
  }
  return url.replace(/^libsql:/, "https:");
}

let cachedClient: Client | null = null;
let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (!cachedDb) {
    cachedClient = createClient({
      url: resolveRuntimeUrl(),
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    cachedDb = drizzle(cachedClient, { schema, casing: "snake_case" });
  }
  return cachedDb;
}

/** Direct libSQL client — for batch() and vector queries that don't fit
 *  the ORM surface. Same cached connection as db(). */
export function libsqlClient(): Client {
  db();
  return cachedClient!;
}

/** Close the underlying client — used by scripts that need a clean exit. */
export async function closeDb() {
  if (cachedClient) {
    cachedClient.close();
    cachedClient = null;
    cachedDb = null;
  }
}

export { schema };
