import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { decideProtectedSessionGate } from "@/lib/auth/admin-gate";
import {
  ADMIN_SESSION_COOKIE,
  sessionIdentityFromCookie,
} from "@/lib/auth/session-identity";
import { CURRENT_POINTER_KEY } from "@/lib/public-content/paths";

const SNAPSHOT_PAGE_PATH =
  /^\/(?:zh|en)(?:\/(?:all|curated|sources|podcasts(?:\/\d+)?|x-monitor|daily(?:\/\d{4}-\d{2}-\d{2})?|agents))?\/?$/;

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

  if (
    isSnapshotBackedPublicPagePath(pathname) &&
    !(await publicSnapshotPointerIsAvailable())
  ) {
    return new Response(
      request.method === "HEAD"
        ? null
        : "<!doctype html><title>Snapshot unavailable</title><h1>Content temporarily unavailable</h1>",
      {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
          "retry-after": "30",
        },
      },
    );
  }

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

export function isSnapshotBackedPublicPagePath(pathname: string): boolean {
  return SNAPSHOT_PAGE_PATH.test(pathname);
}

async function publicSnapshotPointerIsAvailable(): Promise<boolean> {
  const baseUrl = process.env.R2_PUBLIC_BASE_URL?.trim();
  if (!baseUrl) return false;
  try {
    const pointerUrl = new URL(CURRENT_POINTER_KEY, `${baseUrl.replace(/\/$/, "")}/`);
    const response = await fetch(pointerUrl, {
      method: "HEAD",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
