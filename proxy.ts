import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { decideProtectedSessionGate } from "@/lib/auth/admin-gate";
import {
  ADMIN_SESSION_COOKIE,
  sessionIdentityFromCookie,
} from "@/lib/auth/session-identity";

const intl = createMiddleware(routing);

/**
 * Next 16 proxy (formerly `middleware`). Two concerns:
 *
 * 1. Optimistic session gate — /:locale/admin/* and /:locale/saved/* redirect
 *    unauthenticated requests to /:locale/login?next=... The destination page
 *    and route remain the final authorization boundary.
 * 2. next-intl — locale-prefixed routing for every other request.
 *
 * Cookie verification is synchronous and allocation-light. Public paths skip
 * the cookie check; protected destinations still authorize inside the route.
 */
export default async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (!isProtectedSessionPath(pathname)) {
    return intl(request);
  }

  const cookieValue = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const hasSession = sessionIdentityFromCookie(cookieValue) !== null;

  const decision = decideProtectedSessionGate({ pathname, hasSession });
  if (decision.action === "redirect") {
    return NextResponse.redirect(new URL(decision.to, request.nextUrl));
  }
  return intl(request);
}

function isProtectedSessionPath(pathname: string): boolean {
  return /^\/(zh|en)\/(?:admin|saved)(\/|$)/.test(pathname);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
