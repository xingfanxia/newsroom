import {
  ADMIN_SESSION_COOKIE,
  verifySessionCookie,
} from "@/lib/auth/password";

export { ADMIN_SESSION_COOKIE };

export const ADMIN_USER_ID = "admin-local";
const ADMIN_USER_EMAIL = "admin@local";

export type SessionUser = {
  id: string;
  email: string;
  /** Always true when a session exists in the password-gate model. */
  isAdmin: boolean;
};

/**
 * Resolves the fixed password-gate identity from one cookie value.
 *
 * This module deliberately has no framework or database dependencies so the
 * optimistic request Proxy and the hard server-side authorization checks can
 * share exactly the same identity semantics.
 */
export function sessionIdentityFromCookie(
  cookieValue: string | undefined | null,
): SessionUser | null {
  if (!verifySessionCookie(cookieValue)) return null;
  return {
    id: ADMIN_USER_ID,
    email: ADMIN_USER_EMAIL,
    isAdmin: true,
  };
}
