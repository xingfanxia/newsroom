import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import {
  NEWSLETTER_EMAIL_MIGRATION,
  NEWSLETTER_EMAIL_MIGRATION_CHECKSUM,
  migrateNewsletterEmail,
} from "@/lib/email/migration";

let client: Client;
let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "newsroom-email-migration-"));
  client = createClient({
    url: `file:${join(fixtureRoot, "email.sqlite")}`,
  });
});

afterEach(async () => {
  client.close();
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("newsletter email migration", () => {
  test("installs both tables and all indexes, registered with checksum", async () => {
    const first = await migrateNewsletterEmail(client);
    expect(first).toEqual({
      name: NEWSLETTER_EMAIL_MIGRATION,
      checksum: NEWSLETTER_EMAIL_MIGRATION_CHECKSUM,
      applied: true,
    });

    const tables = await client.execute(
      `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name IN ('newsletter_subscribers', 'newsletter_email_sends')
       ORDER BY name`,
    );
    expect(tables.rows.map((row) => String(row.name))).toEqual([
      "newsletter_email_sends",
      "newsletter_subscribers",
    ]);

    const indexes = await client.execute(
      `SELECT name FROM sqlite_master WHERE type = 'index'
       AND name LIKE 'newsletter_%' ORDER BY name`,
    );
    expect(indexes.rows.map((row) => String(row.name))).toEqual([
      "newsletter_email_sends_dedupe_idx",
      "newsletter_email_sends_sent_at_idx",
      "newsletter_subscribers_confirm_tok_idx",
      "newsletter_subscribers_email_idx",
      "newsletter_subscribers_status_idx",
      "newsletter_subscribers_unsub_tok_idx",
    ]);

    const registered = await client.execute({
      sql: "SELECT checksum FROM schema_migrations WHERE name = ?",
      args: [NEWSLETTER_EMAIL_MIGRATION],
    });
    expect(String(registered.rows[0]?.checksum)).toBe(
      NEWSLETTER_EMAIL_MIGRATION_CHECKSUM,
    );
  });

  test("re-run is a no-op", async () => {
    const first = await migrateNewsletterEmail(client);
    const second = await migrateNewsletterEmail(client);
    expect(second).toEqual({ ...first, applied: false });
  });

  test("rejects a same-name migration with a different checksum", async () => {
    await client.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
    )`);
    await client.execute({
      sql: `INSERT INTO schema_migrations (name, checksum, applied_at)
            VALUES (?, 'wrong-checksum', 1)`,
      args: [NEWSLETTER_EMAIL_MIGRATION],
    });

    await expect(migrateNewsletterEmail(client)).rejects.toThrow(
      /migration checksum mismatch/,
    );
    const table = await client.execute(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name = 'newsletter_subscribers'`,
    );
    expect(table.rows).toHaveLength(0);
  });

  test("email is unique case-insensitively (COLLATE NOCASE)", async () => {
    await migrateNewsletterEmail(client);
    await client.execute({
      sql: `INSERT INTO newsletter_subscribers (email, confirm_token, unsubscribe_token)
            VALUES (?, 'c1', 'u1')`,
      args: ["a@example.com"],
    });
    await expect(
      client.execute({
        sql: `INSERT INTO newsletter_subscribers (email, confirm_token, unsubscribe_token)
              VALUES (?, 'c2', 'u2')`,
        args: ["A@Example.COM"],
      }),
    ).rejects.toThrow(/UNIQUE/i);
  });

  test("send ledger dedupes on (email_kind, period_key, subscriber_id)", async () => {
    await migrateNewsletterEmail(client);
    await client.execute(
      `INSERT INTO newsletter_subscribers (email, confirm_token, unsubscribe_token)
       VALUES ('a@example.com', 'c1', 'u1')`,
    );
    await client.execute(
      `INSERT INTO newsletter_email_sends (email_kind, period_key, subscriber_id)
       VALUES ('daily_digest', '2026-07-16', 1)`,
    );
    await expect(
      client.execute(
        `INSERT INTO newsletter_email_sends (email_kind, period_key, subscriber_id)
         VALUES ('daily_digest', '2026-07-16', 1)`,
      ),
    ).rejects.toThrow(/UNIQUE/i);
    // Different kind for the same period+subscriber is allowed.
    await client.execute(
      `INSERT INTO newsletter_email_sends (email_kind, period_key, subscriber_id)
       VALUES ('daily_featured', '2026-07-16', 1)`,
    );
  });

  test("ON DELETE CASCADE is declared; cascade fires with FK enforcement on", async () => {
    // This verifies the DECLARATION. FK enforcement is a per-connection
    // pragma (ON in this file-backed client; NOT guaranteed on prod
    // Turso — see workers/cluster/reconcile.ts cleaning FK orphans by
    // hand). Code paths must never rely on the cascade: subscriber
    // removal is a status flip, and any future hard-delete path must
    // clean newsletter_email_sends explicitly.
    await migrateNewsletterEmail(client);
    const ddl = await client.execute(
      `SELECT sql FROM sqlite_master WHERE name = 'newsletter_email_sends'`,
    );
    expect(String(ddl.rows[0]?.sql)).toContain("ON DELETE CASCADE");

    await client.execute("PRAGMA foreign_keys = ON");
    await client.execute(
      `INSERT INTO newsletter_subscribers (email, confirm_token, unsubscribe_token)
       VALUES ('a@example.com', 'c1', 'u1')`,
    );
    await client.execute(
      `INSERT INTO newsletter_email_sends (email_kind, period_key, subscriber_id)
       VALUES ('daily_digest', '2026-07-16', 1)`,
    );
    await client.execute("DELETE FROM newsletter_subscribers WHERE id = 1");
    const sends = await client.execute("SELECT id FROM newsletter_email_sends");
    expect(sends.rows).toHaveLength(0);
  });

  test("a mid-migration failure rolls back everything and registers nothing", async () => {
    // Pre-create newsletter_subscribers WITHOUT the email column: the
    // CREATE TABLE IF NOT EXISTS silently skips, then the email index
    // statement fails — the transaction must roll back the sends table
    // and leave schema_migrations unregistered.
    await client.execute(
      `CREATE TABLE newsletter_subscribers (id INTEGER PRIMARY KEY)`,
    );
    await expect(migrateNewsletterEmail(client)).rejects.toThrow();
    const sends = await client.execute(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name = 'newsletter_email_sends'`,
    );
    expect(sends.rows).toHaveLength(0);
    const registered = await client.execute({
      sql: "SELECT name FROM schema_migrations WHERE name = ?",
      args: [NEWSLETTER_EMAIL_MIGRATION],
    });
    expect(registered.rows).toHaveLength(0);
  });
});
