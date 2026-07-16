import { and, eq, isNull, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/libsql";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import type {
  EmailKind,
  SendStatus,
  SubscriberStatus,
} from "@/lib/email/contracts";
import { randomToken } from "@/lib/email/tokens";

/**
 * Subscriber repo — the only module that touches the two newsletter
 * tables. Subscriber data is PRIVATE (never enters the public snapshot).
 * All email input is lowercased here; the DDL's COLLATE NOCASE unique
 * index is the backstop, but drizzle queries use BINARY collation so
 * the boundary lowercasing is what makes lookups correct.
 */
export type EmailDb = ReturnType<typeof drizzle<typeof schema>>;

export type SubscribeInput = {
  email: string;
  locale?: string;
  wantsDailyDigest?: boolean;
  wantsDailyFeatured?: boolean;
};

export type SubscribeOutcome =
  | "created"
  | "pending_again"
  | "already_active"
  | "revived"
  | "suppressed";

export type SubscribeResult = {
  outcome: SubscribeOutcome;
  /** Present when a confirm email should be sent (created/pending_again/revived). */
  subscriber?: { id: number; email: string; confirmToken: string };
};

const subscribers = schema.newsletterSubscribers;
const sends = schema.newsletterEmailSends;

function isUniqueConstraintError(error: unknown): boolean {
  // Drizzle wraps the libsql error ("Failed query: ...") — the SQLite
  // code only appears on the cause chain.
  for (let e = error, depth = 0; e != null && depth < 5; depth++) {
    const message = e instanceof Error ? e.message : String(e);
    if (/UNIQUE|SQLITE_CONSTRAINT/i.test(message)) return true;
    e = e instanceof Error ? e.cause : null;
  }
  return false;
}

export async function subscribeOrRevive(
  input: SubscribeInput,
  dbc: EmailDb = db(),
): Promise<SubscribeResult> {
  const email = input.email.trim().toLowerCase();
  const wantsDailyDigest = input.wantsDailyDigest ?? true;
  const wantsDailyFeatured = input.wantsDailyFeatured ?? true;
  const locale = input.locale ?? "zh";

  let existing = await dbc.query.newsletterSubscribers.findFirst({
    where: eq(subscribers.email, email),
  });

  if (!existing) {
    const confirmToken = randomToken();
    try {
      const inserted = await dbc
        .insert(subscribers)
        .values({
          email,
          locale,
          wantsDailyDigest,
          wantsDailyFeatured,
          status: "pending",
          confirmToken,
          unsubscribeToken: randomToken(),
        })
        .returning({ id: subscribers.id });
      return {
        outcome: "created",
        subscriber: { id: inserted[0]!.id, email, confirmToken },
      };
    } catch (error) {
      // Concurrent subscribe race: the loser hits the unique email
      // index — fall through to the existing-row branches instead of
      // surfacing a 500 on a double-click.
      if (!isUniqueConstraintError(error)) throw error;
      existing = await dbc.query.newsletterSubscribers.findFirst({
        where: eq(subscribers.email, email),
      });
      if (!existing) throw error;
    }
  }

  switch (existing.status satisfies SubscriberStatus) {
    case "pending": {
      // Regenerating on every public re-subscribe means a third party
      // can invalidate a victim's pending confirm link — accepted for
      // v1 (rate-limited; blast radius = redo signup).
      const confirmToken = randomToken();
      await dbc
        .update(subscribers)
        .set({ confirmToken, locale, wantsDailyDigest, wantsDailyFeatured })
        .where(eq(subscribers.id, existing.id));
      return {
        outcome: "pending_again",
        subscriber: { id: existing.id, email, confirmToken },
      };
    }
    case "active":
      // No pref mutation without token auth: an attacker knowing an
      // email must not be able to flip a victim's preferences.
      return { outcome: "already_active" };
    case "unsubscribed": {
      const confirmToken = randomToken();
      await dbc
        .update(subscribers)
        .set({
          status: "pending",
          confirmToken,
          locale,
          wantsDailyDigest,
          wantsDailyFeatured,
          unsubscribedAt: null,
          confirmedAt: null,
        })
        .where(eq(subscribers.id, existing.id));
      return {
        outcome: "revived",
        subscriber: { id: existing.id, email, confirmToken },
      };
    }
    case "bounced":
    case "complained":
      // Operator-only unblock; public subscribe stays a generic ok
      // upstream so status is not an enumeration oracle.
      return { outcome: "suppressed" };
    default:
      throw new Error(
        `unhandled subscriber status: ${String(existing.status)}`,
      );
  }
}

export type SubscriberRow = typeof subscribers.$inferSelect;

/** pending → active. Idempotent for active rows; null for unknown tokens
 *  and for rows in any other status (never resurrects unsubscribed). */
export async function confirmByToken(
  token: string,
  dbc: EmailDb = db(),
): Promise<SubscriberRow | null> {
  const existing = await dbc.query.newsletterSubscribers.findFirst({
    where: eq(subscribers.confirmToken, token),
  });
  if (!existing) return null;
  if (existing.status === "active") return existing;
  if (existing.status !== "pending") return null;
  // Status-guarded write: a confirm racing an unsubscribe (mailbox
  // link scanners hit both) must never resurrect the row.
  const confirmedAt = new Date();
  const result = await dbc
    .update(subscribers)
    .set({ status: "active", confirmedAt })
    .where(and(eq(subscribers.id, existing.id), eq(subscribers.status, "pending")));
  if (result.rowsAffected === 0) return null;
  return { ...existing, status: "active", confirmedAt };
}

/** any status → unsubscribed. Idempotent; null for unknown tokens. */
export async function unsubscribeByToken(
  token: string,
  dbc: EmailDb = db(),
): Promise<SubscriberRow | null> {
  const existing = await dbc.query.newsletterSubscribers.findFirst({
    where: eq(subscribers.unsubscribeToken, token),
  });
  if (!existing) return null;
  if (existing.status === "unsubscribed") return existing;
  const unsubscribedAt = new Date();
  await dbc
    .update(subscribers)
    .set({ status: "unsubscribed", unsubscribedAt })
    .where(eq(subscribers.id, existing.id));
  return { ...existing, status: "unsubscribed", unsubscribedAt };
}

export type SendRecipient = {
  id: number;
  email: string;
  unsubscribeToken: string;
};

/** Active subscribers wanting `kind` with no ledger row for `periodKey` —
 *  the ledger-first idempotency read (PLAN.md §4). */
export async function listSendRecipients(
  kind: EmailKind,
  periodKey: string,
  dbc: EmailDb = db(),
): Promise<SendRecipient[]> {
  const wantsColumn =
    kind === "daily_digest"
      ? subscribers.wantsDailyDigest
      : subscribers.wantsDailyFeatured;
  const rows = await dbc
    .select({
      id: subscribers.id,
      email: subscribers.email,
      unsubscribeToken: subscribers.unsubscribeToken,
    })
    .from(subscribers)
    .leftJoin(
      sends,
      and(
        eq(sends.subscriberId, subscribers.id),
        eq(sends.emailKind, kind),
        eq(sends.periodKey, periodKey),
        // Only a SENT row suppresses redelivery — a 'failed' row must
        // leave the recipient eligible for the next run's retry.
        eq(sends.status, "sent"),
      ),
    )
    .where(
      and(
        eq(subscribers.status, "active"),
        eq(wantsColumn, true),
        isNull(sends.id),
      ),
    )
    .orderBy(subscribers.id);
  return rows;
}

export type SendRecord = {
  emailKind: EmailKind;
  periodKey: string;
  subscriberId: number;
  status: SendStatus;
  resendId?: string | null;
  error?: string | null;
};

/** Insert ledger rows after a chunk outcome. A retried chunk must not
 *  throw on the dedupe index, and a later success must overwrite a
 *  'failed' row (otherwise that recipient re-lists forever). */
export async function recordSends(
  records: SendRecord[],
  dbc: EmailDb = db(),
): Promise<void> {
  if (records.length === 0) return;
  await dbc
    .insert(sends)
    .values(
      records.map((record) => ({
        emailKind: record.emailKind,
        periodKey: record.periodKey,
        subscriberId: record.subscriberId,
        status: record.status,
        resendId: record.resendId ?? null,
        error: record.error ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: [sends.emailKind, sends.periodKey, sends.subscriberId],
      set: {
        status: sql`excluded.status`,
        resendId: sql`excluded.resend_id`,
        error: sql`excluded.error`,
        sentAt: sql`excluded.sent_at`,
      },
      // 'sent' is sticky: a later 'failed' record must never re-open a
      // delivered recipient (that would re-list them → double send).
      setWhere: sql`${sends.status} <> 'sent'`,
    });
}
