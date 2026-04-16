import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Neon serverless driver runs over HTTPS and is Fluid-compatible. fetchConnectionCache
// is now always-on by default, no explicit opt-in needed.

function resolveUrl() {
  const url =
    process.env.DATABASE_URL ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Install Neon via Vercel Marketplace or set it manually.",
    );
  }
  return url;
}

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (!cached) {
    const sql = neon(resolveUrl());
    cached = drizzle(sql, { schema, casing: "snake_case" });
  }
  return cached;
}

export { schema };
