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
 * unauthenticated browsing of the public feed stays fast.
 */
export default async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isAdminPath(pathname)) {
    const { client } = createSupabaseProxy(request);
    const {
      data: { user },
    } = await client.auth.getUser();

    const decision = decideAdminGate({
      pathname,
      user: user ? { email: user.email } : null,
    });

    if (decision.action === "redirect") {
      return NextResponse.redirect(new URL(decision.to, request.nextUrl));
    }
  }

  return intl(request);
}

/** Lightweight prefilter so non-admin paths skip the Supabase call entirely. */
function isAdminPath(pathname: string): boolean {
  return /^\/(zh|en)\/admin(\/|$)/.test(pathname);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
