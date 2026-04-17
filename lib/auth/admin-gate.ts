import { isAdminEmail } from "./config";

/**
 * Pure gate decision. Kept separate from the proxy so it can be unit-tested
 * without spinning up Next's runtime.
 *
 * Returns the path to redirect to (always rooted, always same-origin) when
 * the request should be blocked, or null when the request should fall
 * through to the next handler.
 *
 * Design rules:
 * - Only guards /:locale/admin/*. Other paths always fall through.
 * - Default locale for the redirect target matches the path's locale when
 *   present, falling back to zh (the project's defaultLocale).
 * - Unauthenticated → /:locale/login?next=<encoded-original-path>. This
 *   preserves where the user was trying to go so the callback redirect can
 *   round-trip them back.
 * - Authenticated but not on the allowlist → /:locale/403. A friendlier
 *   403 page (rather than a raw 403 response) lets us surface the fail
 *   reason + a "back home" link.
 */
export type AdminGateDecision =
  | { action: "allow" }
  | { action: "redirect"; to: string };

const ADMIN_PATH_PATTERN = /^\/(zh|en)\/admin(\/|$)/;

export type GateInput = {
  pathname: string;
  user: { email: string | null | undefined } | null;
};

export function decideAdminGate(input: GateInput): AdminGateDecision {
  const match = input.pathname.match(ADMIN_PATH_PATTERN);
  if (!match) return { action: "allow" };

  const locale = match[1] as "zh" | "en";

  if (!input.user) {
    const next = encodeURIComponent(input.pathname);
    return { action: "redirect", to: `/${locale}/login?next=${next}` };
  }

  if (!isAdminEmail(input.user.email)) {
    return { action: "redirect", to: `/${locale}/403` };
  }

  return { action: "allow" };
}
