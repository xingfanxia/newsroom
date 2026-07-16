import { z } from "zod";
import { parseJsonRequestBody } from "@/lib/api/json-body";
import type { RateLimitConfig } from "@/lib/api/public-endpoint-config";
import {
  EMAIL_FROM_CONFIRM,
  SITE_ORIGIN,
} from "@/lib/email/contracts";
import { createResendClient, type ResendClient } from "@/lib/email/resend";
import {
  confirmByToken,
  subscribeOrRevive,
  unsubscribeByToken,
  type EmailDb,
} from "@/lib/email/subscribers";
import { renderConfirmEmail } from "@/lib/email/templates/confirm";
import { publicRateLimit } from "@/lib/rate-limit/public";
import { db } from "@/db/client";

/**
 * Newsletter API handlers — routes stay thin wrappers around these.
 * Subscribe is deliberately a non-oracle: every valid-email request
 * returns the same {ok:true}, whether the address is new, pending,
 * active, or suppressed (PLAN.md §3).
 */
export const NEWSLETTER_SUBSCRIBE_RATE_LIMIT = {
  family: "newsletter-subscribe",
  windowMs: 60_000,
  max: 10,
} satisfies RateLimitConfig;

const NEWSLETTER_TOKEN_RATE_LIMIT = {
  family: "newsletter-token",
  windowMs: 60_000,
  max: 60,
} satisfies RateLimitConfig;

const subscribeBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  locale: z.enum(["zh", "en"]).optional(),
  wantsDailyDigest: z.boolean().optional(),
  wantsDailyFeatured: z.boolean().optional(),
});

type NewsletterApiDeps = {
  dbc?: EmailDb;
  resend?: ResendClient;
};

function newsletterPagePath(locale: string, status: string): string {
  // Clamp defensively: only zod-validated locales reach the DB, but the
  // repo layer types locale as string — never echo it into a redirect.
  const safeLocale = locale === "en" ? "en" : "zh";
  return `/${safeLocale}/newsletter?status=${status}`;
}

function redirectTo(path: string): Response {
  // Fixed origin, not req.url — a reflected Host header must not steer
  // the redirect target.
  return Response.redirect(new URL(path, SITE_ORIGIN), 303);
}

export function createNewsletterApi(deps: NewsletterApiDeps = {}) {
  const dbc = () => deps.dbc ?? db();
  // Lazy: only the subscribe path needs Resend, and only when a confirm
  // email is actually due — construction throws without an API key.
  const resend = () => deps.resend ?? createResendClient();

  return {
    async subscribe(req: Request): Promise<Response> {
      const limited = publicRateLimit(req, NEWSLETTER_SUBSCRIBE_RATE_LIMIT);
      if (limited) return limited;

      const parsed = await parseJsonRequestBody(req, subscribeBodySchema, {
        envelope: "ok",
      });
      if (!parsed.ok) return parsed.response;

      const result = await subscribeOrRevive(
        {
          email: parsed.data.email,
          locale: parsed.data.locale,
          wantsDailyDigest: parsed.data.wantsDailyDigest,
          wantsDailyFeatured: parsed.data.wantsDailyFeatured,
        },
        dbc(),
      );

      if (result.subscriber) {
        const confirmUrl = `${SITE_ORIGIN}/api/newsletter/confirm?token=${result.subscriber.confirmToken}`;
        const email = renderConfirmEmail({ confirmUrl });
        try {
          await resend().sendEmail({
            from: EMAIL_FROM_CONFIRM,
            to: result.subscriber.email,
            subject: email.subject,
            html: email.html,
            text: email.text,
          });
        } catch (error) {
          // Loud in logs, invisible in the response: a 200/500 split on
          // the send branch would be a membership oracle (only non-member
          // addresses trigger a send). The user retries by resubmitting.
          // Residual channel: send-path requests pay a Resend round-trip
          // that already_active/suppressed don't — accepted for v1
          // (noisy serverless timing + 10/min rate limit).
          console.error("[newsletter/subscribe] confirm email failed:", error);
        }
      }

      return Response.json({ ok: true });
    },

    async confirm(req: Request): Promise<Response> {
      const limited = publicRateLimit(req, NEWSLETTER_TOKEN_RATE_LIMIT);
      if (limited) return limited;
      const token = new URL(req.url).searchParams.get("token");
      if (!token) return redirectTo(newsletterPagePath("zh", "invalid"));
      const subscriber = await confirmByToken(token, dbc());
      if (!subscriber) {
        return redirectTo(newsletterPagePath("zh", "invalid"));
      }
      return redirectTo(newsletterPagePath(subscriber.locale, "confirmed"));
    },

    async unsubscribe(req: Request): Promise<Response> {
      const limited = publicRateLimit(req, NEWSLETTER_TOKEN_RATE_LIMIT);
      if (limited) return limited;
      const token = new URL(req.url).searchParams.get("token");
      if (!token) return redirectTo(newsletterPagePath("zh", "invalid"));
      const subscriber = await unsubscribeByToken(token, dbc());
      if (!subscriber) {
        return redirectTo(newsletterPagePath("zh", "invalid"));
      }
      return redirectTo(
        newsletterPagePath(subscriber.locale, "unsubscribed"),
      );
    },

    /** RFC 8058 One-Click POST — mailbox providers expect a bare 200. */
    async unsubscribeOneClick(req: Request): Promise<Response> {
      const limited = publicRateLimit(req, NEWSLETTER_TOKEN_RATE_LIMIT);
      if (limited) return limited;
      const token = new URL(req.url).searchParams.get("token");
      if (token) {
        await unsubscribeByToken(token, dbc());
      }
      return Response.json({ ok: true });
    },
  };
}
