/**
 * Newsletter email contracts — the typed vocabulary shared by the
 * subscribers repo, send worker, templates, and API routes.
 * Plan: docs/newsletter-email/PLAN.md (NLE).
 */

/** 每日日报 (the daily column) + 每日精选 (featured/p1 picks with 锐评). */
export const EMAIL_KINDS = ["daily_digest", "daily_featured"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** Per-recipient send-ledger outcome. */
export const SEND_STATUSES = ["sent", "failed"] as const;
export type SendStatus = (typeof SEND_STATUSES)[number];

export const SUBSCRIBER_STATUSES = [
  "pending",
  "active",
  "unsubscribed",
  "bounced",
  "complained",
] as const;
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];

/** Verified sending domain — receiving is disabled, so no reply handling. */
export const EMAIL_FROM_DAILY_DIGEST = "AX 的 AI 雷达 <daily@news.ax0x.ai>";
export const EMAIL_FROM_DAILY_FEATURED =
  "AX 的 AI 雷达 <featured@news.ax0x.ai>";
export const EMAIL_FROM_CONFIRM = "AX 的 AI 雷达 <hello@news.ax0x.ai>";

export const SITE_ORIGIN = "https://news.ax0x.ai";

/** One rendered email — both parts always present (deliverability). */
export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

export type Subscriber = {
  id: number;
  email: string;
  locale: string;
  wantsDailyDigest: boolean;
  wantsDailyFeatured: boolean;
  status: SubscriberStatus;
  confirmToken: string;
  unsubscribeToken: string;
  createdAt: number;
  confirmedAt: number | null;
  unsubscribedAt: number | null;
};
