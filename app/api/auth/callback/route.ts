import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/auth/supabase/server";

/**
 * GET /api/auth/callback?code=…&next=…
 *
 * Supabase redirects the user here after they click the magic link. We
 * exchange the one-time code for a session, then bounce the user to `next`
 * (default: /zh, the home page in the default locale).
 *
 * If the exchange fails, send them back to /zh/login?error=callback_failed
 * so the UI can surface a readable message.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = sanitizeNext(url.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(
      new URL("/zh/login?error=missing_code", url.origin),
    );
  }

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[auth/callback] exchange failed", error);
    return NextResponse.redirect(
      new URL("/zh/login?error=callback_failed", url.origin),
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}

/**
 * Only allow same-origin redirects so the callback can't be weaponised into
 * an open redirect. Reject anything that starts with `//`, `http`, or is
 * not rooted at `/`.
 */
function sanitizeNext(raw: string | null): string {
  if (!raw) return "/zh";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/zh";
  if (raw.startsWith("/api")) return "/zh";
  return raw;
}
