/**
 * POST /api/newsletter/subscribe — double-opt-in signup.
 *
 * - 200 { ok: true } for every valid email (no enumeration oracle) —
 *   confirm-send failures are logged loudly but still return 200
 *   (a 200/500 split would leak membership; user retries by resubmitting)
 * - 400 on invalid body (zod issues)
 * - 429 past the newsletter-subscribe rate-limit family
 */
import { createNewsletterApi } from "@/lib/email/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  return createNewsletterApi().subscribe(req);
}
