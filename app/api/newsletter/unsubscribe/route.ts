/**
 * GET  /api/newsletter/unsubscribe?token= — footer unsubscribe link.
 *      303 → /{locale}/newsletter?status=unsubscribed|invalid
 * POST — RFC 8058 List-Unsubscribe One-Click (mailbox providers): bare 200.
 */
import { createNewsletterApi } from "@/lib/email/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return createNewsletterApi().unsubscribe(req);
}

export async function POST(req: Request) {
  return createNewsletterApi().unsubscribeOneClick(req);
}
