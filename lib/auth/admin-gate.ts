import {
  appLocaleFromPathname,
  stripAppLocalePathPrefix,
} from "@/lib/types";

/**
 * Pure gate decision for /:locale/admin/*. Since the switch to password-gated
 * auth there is no per-user allowlist — a valid session cookie implies admin,
 * and `user == null` is the only failure mode that matters to the proxy.
 */
export type AdminGateDecision =
  | { action: "allow" }
  | { action: "redirect"; to: string };

export type GateInput = {
  pathname: string;
  hasSession: boolean;
};

export function decideAdminGate(input: GateInput): AdminGateDecision {
  const locale = appLocaleFromPathname(input.pathname);
  if (!locale) return { action: "allow" };
  const rest = stripAppLocalePathPrefix(input.pathname);
  if (rest !== "/admin" && !rest.startsWith("/admin/")) {
    return { action: "allow" };
  }
  if (input.hasSession) return { action: "allow" };
  const next = encodeURIComponent(input.pathname);
  return { action: "redirect", to: `/${locale}/login?next=${next}` };
}
