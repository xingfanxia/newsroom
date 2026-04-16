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
 * Migrations & schema ops use the NON-pooling URL — PgBouncer transaction
 * pooling breaks DDL and prepared statements that drizzle-kit relies on.
 */
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.POSTGRES_URL_NON_POOLING ??
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "",
  },
  verbose: true,
  strict: true,
  casing: "snake_case",
});
