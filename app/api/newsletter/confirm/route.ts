/**
 * GET /api/newsletter/confirm?token= — double-opt-in confirmation link.
 * 303 → /{locale}/newsletter?status=confirmed|invalid
 */
import { createNewsletterApi } from "@/lib/email/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return createNewsletterApi().confirm(req);
}
