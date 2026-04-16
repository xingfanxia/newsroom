import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.POSTGRES_URL ??
      "",
  },
  verbose: true,
  strict: true,
  casing: "snake_case",
});
