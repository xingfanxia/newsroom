import { defineConfig } from "drizzle-kit";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// drizzle-kit runs outside bun's env-loader, so walk .env.local ourselves.
// Only populates missing vars, preserving any set via shell.
try {
  const content = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    if (process.env[key] != null && process.env[key] !== "") continue;
    const val = rawVal.trim().replace(/^"(.*)"$/, "$1");
    process.env[key] = val;
  }
} catch {
  // .env.local is optional — rely on shell env in CI / prod.
}

/**
 * Turso libSQL (NEWSROOM-TURSO, 2026-07-11).
 *
 * ⚠️ `db:push` caveats on this schema:
 *   - drizzle-kit false-diffs custom-typed columns (drizzle-orm #3047) — a
 *     push may propose dropping/recreating `items.embedding`. NEVER accept
 *     that plan; it destroys the stored vectors.
 *   - drizzle-kit cannot express the DiskANN vector index. After any push,
 *     re-run `bun run db:vector-index` (idempotent).
 * Prefer `db:generate` + reviewed migrations for schema changes.
 */
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
  verbose: true,
  strict: true,
  casing: "snake_case",
});
