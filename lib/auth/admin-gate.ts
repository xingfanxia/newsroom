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

function decideGateForRoots(
  input: GateInput,
  protectedRoots: readonly string[],
): AdminGateDecision {
  const locale = appLocaleFromPathname(input.pathname);
  if (!locale) return { action: "allow" };
  const rest = stripAppLocalePathPrefix(input.pathname);
  if (
    !protectedRoots.some(
      (root) => rest === root || rest.startsWith(`${root}/`),
    )
  ) {
    return { action: "allow" };
  }
  if (input.hasSession) return { action: "allow" };
  const next = encodeURIComponent(input.pathname);
  return { action: "redirect", to: `/${locale}/login?next=${next}` };
}

export function decideAdminGate(input: GateInput): AdminGateDecision {
  return decideGateForRoots(input, ["/admin"]);
}

/** Optimistic navigation gate only; pages and routes still authorize again. */
export function decideProtectedSessionGate(
  input: GateInput,
): AdminGateDecision {
  return decideGateForRoots(input, ["/admin", "/saved"]);
}
