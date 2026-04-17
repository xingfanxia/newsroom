import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { createSupabaseProxy } from "@/lib/auth/supabase/proxy";
import { decideAdminGate } from "@/lib/auth/admin-gate";

const intl = createMiddleware(routing);

/**
 * Next 16 proxy (formerly `middleware`). Composes two concerns:
 *
 * 1. Admin gate — /:locale/admin/* redirects unauthenticated users to
 *    /:locale/login?next=... and non-admin authenticated users to
 *    /:locale/403. See lib/auth/admin-gate.ts for the pure decision.
 * 2. next-intl — locale-prefixed routing for every other request.
 *
 * We only talk to Supabase when the path matches the admin pattern, so
 * unauthenticated browsing of the public feed stays fast. When we do call
 * Supabase, getUser() may rotate the session cookies; we copy those onto
 * whatever response we ultimately return so the browser sees them.
 */
export default async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (!isAdminPath(pathname)) {
    return intl(request);
  }

  const { client, response: authResponse } = createSupabaseProxy(request);
  const {
    data: { user },
  } = await client.auth.getUser();

  const decision = decideAdminGate({
    pathname,
    user: user ? { email: user.email } : null,
  });

  if (decision.action === "redirect") {
    const redirect = NextResponse.redirect(
      new URL(decision.to, request.nextUrl),
    );
    mergeCookies(authResponse, redirect);
    return redirect;
  }

  // Admin allowed — hand off to next-intl but keep any refreshed
  // auth cookies so the browser stores the new session.
  const intlResponse = intl(request);
  mergeCookies(authResponse, intlResponse);
  return intlResponse;
}

/** Copy every cookie Supabase set on `src` onto `dest`. Safe when dest is a
 *  redirect or a next-intl response — `.cookies.set` is available on both. */
function mergeCookies(src: NextResponse, dest: NextResponse | Response) {
  if (!("cookies" in dest) || typeof dest.cookies.set !== "function") return;
  for (const cookie of src.cookies.getAll()) {
    dest.cookies.set(cookie);
  }
}

function isAdminPath(pathname: string): boolean {
  return /^\/(zh|en)\/admin(\/|$)/.test(pathname);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
