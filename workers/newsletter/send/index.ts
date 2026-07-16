/**
 * Newsletter email send worker — delivers the EXISTING daily column
 * (每日日报) and the window's featured/p1 items (每日精选) to confirmed
 * subscribers via Resend. Idempotency is ledger-first: the unique
 * (email_kind, period_key, subscriber_id) index means a re-run only
 * touches recipients with no ledger row (PLAN.md §4).
 *
 * Cron: 40 5 * * * UTC — 40 min after daily-column generation starts.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import {
  EMAIL_FROM_DAILY_DIGEST,
  EMAIL_FROM_DAILY_FEATURED,
  SITE_ORIGIN,
  type EmailKind,
  type RenderedEmail,
} from "@/lib/email/contracts";
import {
  createResendClient,
  RESEND_BATCH_LIMIT,
  type OutgoingEmail,
  type ResendClient,
} from "@/lib/email/resend";
import {
  listSendRecipients,
  recordSends,
  type EmailDb,
  type SendRecipient,
} from "@/lib/email/subscribers";
import { renderDailyDigestEmail } from "@/lib/email/templates/daily-digest";
import {
  renderDailyFeaturedEmail,
  type FeaturedStory,
} from "@/lib/email/templates/daily-featured";
import { DAILY_COLUMN_LOCALE, DAILY_NEWSLETTER_KIND } from "@/lib/types";
import { utcYmdFromDate } from "../aihot-daily";

/** A column older than this is yesterday's news — skip rather than resend. */
const COLUMN_MAX_AGE_MS = 26 * 60 * 60 * 1000;
const FEATURED_CAP = 10;
/** Suffixed to keep a literal collision with authored content out of the
 *  realm of possibility — replaced per recipient after rendering. */
const UNSUB_TOKEN_PLACEHOLDER = "__NLE_UNSUB_TOKEN_c9d51f__";

export type SendKindResult = {
  kind: EmailKind;
  /** 'failed' = recipients existed but zero chunks were delivered. */
  status: "sent" | "skipped" | "failed";
  reason?: "no-column" | "no-featured" | "no-subscribers" | "all-sent";
  sent: number;
  failed: number;
  chunks: number;
};

export type SendReport = {
  periodKey: string | null;
  results: SendKindResult[];
  dryRun: boolean;
  durationMs: number;
};

export type RunNewsletterSendOptions = {
  now?: Date;
  /** Render + count recipients, but no network and no ledger writes. */
  dryRun?: boolean;
  dbc?: EmailDb;
  resend?: ResendClient;
};

function unsubscribeUrlFor(token: string): string {
  return `${SITE_ORIGIN}/api/newsletter/unsubscribe?token=${token}`;
}

function chunkIdempotencyKey(
  kind: EmailKind,
  periodKey: string,
  emails: string[],
): string {
  const digest = createHash("sha256")
    .update([...emails].sort().join("\n"), "utf8")
    .digest("hex")
    .slice(0, 16);
  return `newsroom/${kind}/${periodKey}/${digest}`;
}

function chunk<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

function skipped(
  kind: EmailKind,
  reason: NonNullable<SendKindResult["reason"]>,
): SendKindResult {
  return { kind, status: "skipped", reason, sent: 0, failed: 0, chunks: 0 };
}

async function sendKind(args: {
  kind: EmailKind;
  periodKey: string;
  from: string;
  rendered: RenderedEmail;
  dbc: EmailDb;
  resend: () => ResendClient;
  dryRun: boolean;
}): Promise<SendKindResult> {
  const { kind, periodKey, dbc } = args;
  const recipients = await listSendRecipients(kind, periodKey, dbc);
  if (recipients.length === 0) {
    const wantsColumn =
      kind === "daily_digest"
        ? schema.newsletterSubscribers.wantsDailyDigest
        : schema.newsletterSubscribers.wantsDailyFeatured;
    const active = await dbc
      .select({ id: schema.newsletterSubscribers.id })
      .from(schema.newsletterSubscribers)
      .where(
        and(
          eq(schema.newsletterSubscribers.status, "active"),
          eq(wantsColumn, true),
        ),
      )
      .limit(1);
    return skipped(kind, active.length === 0 ? "no-subscribers" : "all-sent");
  }

  if (args.dryRun) {
    return {
      kind,
      status: "sent",
      sent: recipients.length,
      failed: 0,
      chunks: chunk(recipients, RESEND_BATCH_LIMIT).length,
    };
  }

  // Construct BEFORE the chunk loop: a missing RESEND_API_KEY must throw
  // loudly once (cron 500), not be mislabeled as per-chunk failures.
  const resendClient = args.resend();
  const replyTo = process.env.NEWSLETTER_REPLY_TO;
  const toEmail = (recipient: SendRecipient): OutgoingEmail => {
    const unsubscribeUrl = unsubscribeUrlFor(recipient.unsubscribeToken);
    return {
      from: args.from,
      to: recipient.email,
      subject: args.rendered.subject,
      html: args.rendered.html.replaceAll(
        UNSUB_TOKEN_PLACEHOLDER,
        recipient.unsubscribeToken,
      ),
      text: args.rendered.text.replaceAll(
        UNSUB_TOKEN_PLACEHOLDER,
        recipient.unsubscribeToken,
      ),
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      ...(replyTo ? { replyTo } : {}),
    };
  };

  let sent = 0;
  let failed = 0;
  let chunks = 0;
  for (const recipientChunk of chunk(recipients, RESEND_BATCH_LIMIT)) {
    chunks++;
    const emails = recipientChunk.map(toEmail);
    try {
      const result = await resendClient.sendBatch(emails, {
        idempotencyKey: chunkIdempotencyKey(
          kind,
          periodKey,
          recipientChunk.map((r) => r.email),
        ),
      });
      await recordSends(
        recipientChunk.map((recipient, index) => ({
          emailKind: kind,
          periodKey,
          subscriberId: recipient.id,
          status: "sent" as const,
          resendId: result.ids[index] ?? null,
        })),
        dbc,
      );
      sent += recipientChunk.length;
    } catch (error) {
      // Loud, but keep going: the ledger has no rows for this chunk,
      // so the next run retries exactly these recipients.
      failed += recipientChunk.length;
      console.error(
        `[newsletter/send] ${kind} chunk of ${recipientChunk.length} failed:`,
        error,
      );
    }
  }
  return {
    kind,
    status: sent === 0 && failed > 0 ? "failed" : "sent",
    sent,
    failed,
    chunks,
  };
}

export async function runNewsletterSend(
  opts: RunNewsletterSendOptions = {},
): Promise<SendReport> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const dbc = opts.dbc ?? db();
  const dryRun = opts.dryRun ?? false;
  // Lazy: dry runs and skip paths never need credentials.
  let resendClient: ResendClient | null = opts.resend ?? null;
  const resend = () => {
    if (!resendClient) resendClient = createResendClient();
    return resendClient;
  };

  const columns = await dbc
    .select({
      id: schema.newsletters.id,
      periodStart: schema.newsletters.periodStart,
      periodEnd: schema.newsletters.periodEnd,
      columnTitle: schema.newsletters.columnTitle,
      columnThemeTag: schema.newsletters.columnThemeTag,
      columnSummaryMd: schema.newsletters.columnSummaryMd,
      columnNarrativeMd: schema.newsletters.columnNarrativeMd,
      columnFeaturedItemIds: schema.newsletters.columnFeaturedItemIds,
      itemIds: schema.newsletters.itemIds,
    })
    .from(schema.newsletters)
    .where(
      and(
        eq(schema.newsletters.kind, DAILY_NEWSLETTER_KIND),
        eq(schema.newsletters.locale, DAILY_COLUMN_LOCALE),
        isNotNull(schema.newsletters.columnTitle),
        gte(
          schema.newsletters.periodEnd,
          new Date(now.getTime() - COLUMN_MAX_AGE_MS),
        ),
      ),
    )
    .orderBy(desc(schema.newsletters.periodEnd))
    .limit(1);
  const column = columns[0];

  if (!column) {
    return {
      periodKey: null,
      results: [
        skipped("daily_digest", "no-column"),
        skipped("daily_featured", "no-column"),
      ],
      dryRun,
      durationMs: Date.now() - started,
    };
  }

  const periodKey = utcYmdFromDate(column.periodEnd);
  const unsubscribeUrlTemplate = unsubscribeUrlFor(UNSUB_TOKEN_PLACEHOLDER);

  // ── 日报 body: resolve [#NNNN] refs + featured callout to EXTERNAL urls ──
  const referencedIds = [
    ...new Set([
      ...(column.itemIds ?? []),
      ...(column.columnFeaturedItemIds ?? []),
    ]),
  ];
  const referencedItems = referencedIds.length
    ? await dbc
        .select({
          id: schema.items.id,
          title: schema.items.title,
          titleZh: schema.items.titleZh,
          url: schema.items.url,
        })
        .from(schema.items)
        .where(inArray(schema.items.id, referencedIds))
    : [];
  const itemUrlById = new Map(referencedItems.map((row) => [row.id, row.url]));
  const itemById = new Map(referencedItems.map((row) => [row.id, row]));

  const digestEmail = renderDailyDigestEmail({
    title: column.columnTitle ?? "",
    themeTag: column.columnThemeTag,
    dateKey: periodKey,
    summaryMd: column.columnSummaryMd ?? "",
    narrativeMd: column.columnNarrativeMd ?? "",
    featured: (column.columnFeaturedItemIds ?? [])
      .map((id) => itemById.get(id))
      .filter((row): row is NonNullable<typeof row> => row != null)
      .map((row) => ({
        id: row.id,
        title: row.titleZh ?? row.title,
        url: row.url,
      })),
    itemUrlById,
    unsubscribeUrl: unsubscribeUrlTemplate,
  });

  // ── 精选 body: window's featured/p1 items with 锐评 ──
  const featuredRows = await dbc
    .select({
      id: schema.items.id,
      title: schema.items.title,
      titleZh: schema.items.titleZh,
      url: schema.items.url,
      summaryZh: schema.items.summaryZh,
      analysisZh: schema.items.editorAnalysisZh,
      tier: schema.items.tier,
      importance: schema.items.importance,
      sourceNameZh: schema.sources.nameZh,
      sourceNameEn: schema.sources.nameEn,
    })
    .from(schema.items)
    .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
    .where(
      and(
        inArray(schema.items.tier, ["featured", "p1"]),
        gte(schema.items.enrichedAt, column.periodStart),
        lt(schema.items.enrichedAt, column.periodEnd),
      ),
    )
    .orderBy(desc(schema.items.importance))
    .limit(FEATURED_CAP);

  const stories: FeaturedStory[] = featuredRows.map((row) => ({
    id: row.id,
    title: row.titleZh ?? row.title,
    url: row.url,
    sourceName: row.sourceNameZh ?? row.sourceNameEn,
    tier: row.tier,
    importance: row.importance,
    summary: row.summaryZh,
    analysis: row.analysisZh,
  }));

  const digestResult = await sendKind({
    kind: "daily_digest",
    periodKey,
    from: EMAIL_FROM_DAILY_DIGEST,
    rendered: digestEmail,
    dbc,
    resend,
    dryRun,
  });

  const featuredResult =
    stories.length === 0
      ? skipped("daily_featured", "no-featured")
      : await sendKind({
          kind: "daily_featured",
          periodKey,
          from: EMAIL_FROM_DAILY_FEATURED,
          rendered: renderDailyFeaturedEmail({
            dateKey: periodKey,
            stories,
            unsubscribeUrl: unsubscribeUrlTemplate,
          }),
          dbc,
          resend,
          dryRun,
        });

  return {
    periodKey,
    results: [digestResult, featuredResult],
    dryRun,
    durationMs: Date.now() - started,
  };
}
