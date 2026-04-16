import postgres from "postgres";

async function main() {
  const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!url) {
    console.error("No POSTGRES_URL set");
    process.exit(2);
  }

  console.log(
    `connecting to ${url.replace(/:[^:@]+@/, ":***@").slice(0, 80)}...`,
  );
  const sql = postgres(url, {
    prepare: false,
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    ssl: "require",
  });

  try {
    const rows = await sql`SELECT 1 AS ok, version() AS version, current_database() AS db`;
    console.log("✓ connected");
    console.log(JSON.stringify(rows[0], null, 2));

    const ext = await sql`SELECT extname FROM pg_extension WHERE extname IN ('vector','pg_trgm')`;
    console.log("extensions:", ext.map((e) => e.extname));
  } catch (err) {
    console.error("✗ failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 3 });
  }
}

main();
