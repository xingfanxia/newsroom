import { desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import type { EmailKind, SubscriberStatus } from "@/lib/email/contracts";
import type { EmailDb } from "@/lib/email/subscribers";

/**
 * /admin/newsletter data loader — subscriber counts + send-ledger
 * tracking. Admin-only surface (private tables stay private; this
 * never feeds the public snapshot).
 */
export type NewsletterAdminStats = {
  subscribers: {
    total: number;
    active: number;
    pending: number;
    unsubscribed: number;
    bounced: number;
    complained: number;
    /** Kind preferences among ACTIVE subscribers only. */
    activeWantsDigest: number;
    activeWantsFeatured: number;
  };
  /** Per (period, kind) ledger rollup, newest period first. */
  sends: Array<{
    periodKey: string;
    kind: EmailKind;
    sent: number;
    failed: number;
    lastSentAt: Date | null;
  }>;
  totals: { delivered: number; failed: number };
  recentSubscribers: Array<{
    email: string;
    status: SubscriberStatus;
    locale: string;
    wantsDailyDigest: boolean;
    wantsDailyFeatured: boolean;
    createdAt: Date;
    confirmedAt: Date | null;
  }>;
};

const subscribers = schema.newsletterSubscribers;
const sends = schema.newsletterEmailSends;

const RECENT_SUBSCRIBERS_LIMIT = 20;
const SEND_PERIOD_ROWS_LIMIT = 28; // 14 days × 2 kinds

export async function getNewsletterAdminStats(
  dbc: EmailDb = db(),
): Promise<NewsletterAdminStats> {
  const [counts] = await dbc
    .select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) filter (where ${subscribers.status} = 'active')`,
      pending: sql<number>`count(*) filter (where ${subscribers.status} = 'pending')`,
      unsubscribed: sql<number>`count(*) filter (where ${subscribers.status} = 'unsubscribed')`,
      bounced: sql<number>`count(*) filter (where ${subscribers.status} = 'bounced')`,
      complained: sql<number>`count(*) filter (where ${subscribers.status} = 'complained')`,
      activeWantsDigest: sql<number>`count(*) filter (where ${subscribers.status} = 'active' and ${subscribers.wantsDailyDigest} = 1)`,
      activeWantsFeatured: sql<number>`count(*) filter (where ${subscribers.status} = 'active' and ${subscribers.wantsDailyFeatured} = 1)`,
    })
    .from(subscribers);

  const sendRows = await dbc
    .select({
      periodKey: sends.periodKey,
      kind: sends.emailKind,
      sent: sql<number>`count(*) filter (where ${sends.status} = 'sent')`,
      failed: sql<number>`count(*) filter (where ${sends.status} = 'failed')`,
      lastSentAtMs: sql<number | null>`max(${sends.sentAt})`,
    })
    .from(sends)
    .groupBy(sends.periodKey, sends.emailKind)
    .orderBy(desc(sends.periodKey), sends.emailKind)
    .limit(SEND_PERIOD_ROWS_LIMIT);

  const [sendTotals] = await dbc
    .select({
      delivered: sql<number>`count(*) filter (where ${sends.status} = 'sent')`,
      failed: sql<number>`count(*) filter (where ${sends.status} = 'failed')`,
    })
    .from(sends);

  const recentSubscribers = await dbc
    .select({
      email: subscribers.email,
      status: subscribers.status,
      locale: subscribers.locale,
      wantsDailyDigest: subscribers.wantsDailyDigest,
      wantsDailyFeatured: subscribers.wantsDailyFeatured,
      createdAt: subscribers.createdAt,
      confirmedAt: subscribers.confirmedAt,
    })
    .from(subscribers)
    .orderBy(desc(subscribers.createdAt), desc(subscribers.id))
    .limit(RECENT_SUBSCRIBERS_LIMIT);

  return {
    subscribers: {
      total: Number(counts?.total ?? 0),
      active: Number(counts?.active ?? 0),
      pending: Number(counts?.pending ?? 0),
      unsubscribed: Number(counts?.unsubscribed ?? 0),
      bounced: Number(counts?.bounced ?? 0),
      complained: Number(counts?.complained ?? 0),
      activeWantsDigest: Number(counts?.activeWantsDigest ?? 0),
      activeWantsFeatured: Number(counts?.activeWantsFeatured ?? 0),
    },
    sends: sendRows.map((row) => ({
      periodKey: row.periodKey,
      kind: row.kind,
      sent: Number(row.sent),
      failed: Number(row.failed),
      lastSentAt: row.lastSentAtMs ? new Date(Number(row.lastSentAtMs)) : null,
    })),
    totals: {
      delivered: Number(sendTotals?.delivered ?? 0),
      failed: Number(sendTotals?.failed ?? 0),
    },
    recentSubscribers,
  };
}
