import { defineConfig } from "drizzle-kit";

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
