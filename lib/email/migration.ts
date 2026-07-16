import { createHash } from "node:crypto";
import type { Client } from "@libsql/client";

/**
 * Newsletter email schema migration — checksummed raw-SQL runner following
 * lib/public-content/publisher/outbox-migration.ts. NEVER applied via
 * db:push (hard-banned in this repo); apply through
 * scripts/ops/migrate-newsletter-email.ts --apply.
 */
export const NEWSLETTER_EMAIL_MIGRATION = "20260716_newsletter_email_v1";

const NOW_MS_SQL = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";

const SCHEMA_MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT (${NOW_MS_SQL})
)`;

const SUBSCRIBERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE,
  locale TEXT NOT NULL DEFAULT 'zh',
  wants_daily_digest INTEGER NOT NULL DEFAULT 1,
  wants_daily_featured INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  confirm_token TEXT NOT NULL,
  unsubscribe_token TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (${NOW_MS_SQL}),
  confirmed_at INTEGER,
  unsubscribed_at INTEGER
)`;

const SENDS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS newsletter_email_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_kind TEXT NOT NULL,
  period_key TEXT NOT NULL,
  subscriber_id INTEGER NOT NULL REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'sent',
  resend_id TEXT,
  error TEXT,
  sent_at INTEGER NOT NULL DEFAULT (${NOW_MS_SQL})
)`;

const NEWSLETTER_EMAIL_MIGRATION_STATEMENTS = [
  SUBSCRIBERS_TABLE_SQL,
  `CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_email_idx
ON newsletter_subscribers (email)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_confirm_tok_idx
ON newsletter_subscribers (confirm_token)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_unsub_tok_idx
ON newsletter_subscribers (unsubscribe_token)`,
  `CREATE INDEX IF NOT EXISTS newsletter_subscribers_status_idx
ON newsletter_subscribers (status)`,
  SENDS_TABLE_SQL,
  `CREATE UNIQUE INDEX IF NOT EXISTS newsletter_email_sends_dedupe_idx
ON newsletter_email_sends (email_kind, period_key, subscriber_id)`,
  `CREATE INDEX IF NOT EXISTS newsletter_email_sends_sent_at_idx
ON newsletter_email_sends (sent_at)`,
] as const;

export const NEWSLETTER_EMAIL_MIGRATION_CHECKSUM = createHash("sha256")
  .update(
    [SCHEMA_MIGRATIONS_TABLE_SQL, ...NEWSLETTER_EMAIL_MIGRATION_STATEMENTS]
      .join(";\n")
      .concat("\n"),
    "utf8",
  )
  .digest("hex");

export type NewsletterEmailMigrationResult = {
  name: typeof NEWSLETTER_EMAIL_MIGRATION;
  checksum: string;
  applied: boolean;
};

export async function migrateNewsletterEmail(
  client: Client,
): Promise<NewsletterEmailMigrationResult> {
  await client.execute(SCHEMA_MIGRATIONS_TABLE_SQL);
  const transaction = await client.transaction("write");
  try {
    const existing = await transaction.execute({
      sql: "SELECT checksum FROM schema_migrations WHERE name = ?",
      args: [NEWSLETTER_EMAIL_MIGRATION],
    });
    if (existing.rows.length > 0) {
      const checksum = String(existing.rows[0]?.checksum ?? "");
      if (checksum !== NEWSLETTER_EMAIL_MIGRATION_CHECKSUM) {
        throw new Error(
          `migration checksum mismatch for ${NEWSLETTER_EMAIL_MIGRATION}`,
        );
      }
      await transaction.commit();
      return {
        name: NEWSLETTER_EMAIL_MIGRATION,
        checksum,
        applied: false,
      };
    }

    for (const statement of NEWSLETTER_EMAIL_MIGRATION_STATEMENTS) {
      await transaction.execute(statement);
    }
    await transaction.execute({
      sql: `INSERT INTO schema_migrations (name, checksum)
            VALUES (?, ?)`,
      args: [NEWSLETTER_EMAIL_MIGRATION, NEWSLETTER_EMAIL_MIGRATION_CHECKSUM],
    });
    await transaction.commit();
    return {
      name: NEWSLETTER_EMAIL_MIGRATION,
      checksum: NEWSLETTER_EMAIL_MIGRATION_CHECKSUM,
      applied: true,
    };
  } finally {
    transaction.close();
  }
}
