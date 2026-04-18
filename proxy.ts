import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { decideAdminGate } from "@/lib/auth/admin-gate";
import {
  ADMIN_SESSION_COOKIE,
  verifySessionCookie,
} from "@/lib/auth/password";

const intl = createMiddleware(routing);

/**
 * Next 16 proxy (formerly `middleware`). Two concerns:
 *
 * 1. Admin gate — /:locale/admin/* redirects unauthenticated requests to
 *    /:locale/login?next=... See lib/auth/admin-gate.ts for the pure decision.
 * 2. next-intl — locale-prefixed routing for every other request.
 *
 * Cookie verification is synchronous + allocation-free; every request hits
 * the admin gate. We can't scope the cookie check to /admin/* because we
 * also want `isSignedIn` visible on public pages later (for showing "log out"
 * vs "log in" affordances).
 */
export default async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (!isAdminPath(pathname)) {
    return intl(request);
  }

  const cookieValue = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const hasSession = verifySessionCookie(cookieValue);

  const decision = decideAdminGate({ pathname, hasSession });
  if (decision.action === "redirect") {
    return NextResponse.redirect(new URL(decision.to, request.nextUrl));
  }
  return intl(request);
}

function isAdminPath(pathname: string): boolean {
  return /^\/(zh|en)\/admin(\/|$)/.test(pathname);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
