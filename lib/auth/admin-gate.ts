/**
 * Pure gate decision for /:locale/admin/*. Since the switch to password-gated
 * auth there is no per-user allowlist — a valid session cookie implies admin,
 * and `user == null` is the only failure mode that matters to the proxy.
 */
export type AdminGateDecision =
  | { action: "allow" }
  | { action: "redirect"; to: string };

const ADMIN_PATH_PATTERN = /^\/(zh|en)\/admin(\/|$)/;

export type GateInput = {
  pathname: string;
  hasSession: boolean;
};

export function decideAdminGate(input: GateInput): AdminGateDecision {
  const match = input.pathname.match(ADMIN_PATH_PATTERN);
  if (!match) return { action: "allow" };
  const locale = match[1] as "zh" | "en";
  if (input.hasSession) return { action: "allow" };
  const next = encodeURIComponent(input.pathname);
  return { action: "redirect", to: `/${locale}/login?next=${next}` };
}
