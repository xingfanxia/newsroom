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

/** True if `err` is a transient SQLite write-lock contention error. SQLite is
 *  single-writer; under worker fan-out a write can lose the lock race and
 *  surface as SQLITE_BUSY / "database is locked". */
export function isBusyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /SQLITE_BUSY|database is locked|database table is locked/i.test(msg);
}

/**
 * Retry a libSQL write on transient SQLITE_BUSY contention (W7a). Capped
 * exponential backoff; rethrows non-busy errors immediately and rethrows the
 * busy error after the final attempt (loud failure — never swallowed). Wrap
 * whole transactions, not individual statements: a rolled-back transaction is
 * safe to re-run in full.
 *
 * `sleep` is injectable so tests can drive the backoff without real timers.
 */
export async function withBusyRetry<T>(
  fn: () => Promise<T>,
  opts: {
    retries?: number;
    baseDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 50;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isBusyError(err) || attempt >= retries) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
}

type SchemaDb = ReturnType<typeof drizzle<typeof schema>>;
type SchemaTx = Parameters<Parameters<SchemaDb["transaction"]>[0]>[0];

/**
 * A drizzle `client.transaction(...)` wrapped in withBusyRetry (W7a). Drop-in
 * for `client.transaction(fn, config)` — same signature, plus transparent
 * SQLITE_BUSY retry of the whole (atomic, rolled-back-on-failure) transaction.
 */
export function retryTransaction<T>(
  client: SchemaDb,
  fn: (tx: SchemaTx) => Promise<T>,
  config?: Parameters<SchemaDb["transaction"]>[1],
): Promise<T> {
  return withBusyRetry(() => client.transaction(fn, config));
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
