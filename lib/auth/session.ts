/**
 * Admin session — cookie-based. After PR #password-auth-gate the project
 * runs on a single shared admin password (ADMIN_PASSWORD) instead of
 * Supabase magic-link + per-user allowlist. Any valid session cookie is
 * considered admin; there is no reader / editor tier.
 *
 * Feedback rows still reference a user row for FK integrity. We seed one
 * fixed "admin-local" user and attribute every vote to it. If the project
 * grows back to multi-user, reintroduce a real identity layer before
 * dropping this synthetic row.
 */
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  ADMIN_SESSION_COOKIE,
  verifySessionCookie,
} from "./password";

export const ADMIN_USER_ID = "admin-local";
const ADMIN_USER_EMAIL = "admin@local";

export type SessionUser = {
  id: string;
  email: string;
  /** Always true when a session exists in the password-gate model. */
  isAdmin: boolean;
};

/**
 * Returns the fixed admin user when a valid session cookie is present,
 * otherwise null. Never throws.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const value = store.get(ADMIN_SESSION_COOKIE)?.value;
  if (!verifySessionCookie(value)) return null;
  return {
    id: ADMIN_USER_ID,
    email: ADMIN_USER_EMAIL,
    isAdmin: true,
  };
}

export class UnauthorizedError extends Error {
  constructor(message = "authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "admin required") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Every authenticated session is admin in the password-gate model. */
export async function requireAdmin(): Promise<SessionUser> {
  return requireUser();
}

/**
 * Ensures the fixed admin user row exists. Called before every feedback
 * mutation so the FK to `users.id` never surprises us.
 */
export async function upsertAppUser(
  _user: Pick<SessionUser, "id" | "email" | "isAdmin">,
): Promise<void> {
  await db()
    .insert(schema.users)
    .values({
      id: ADMIN_USER_ID,
      email: ADMIN_USER_EMAIL,
      role: "admin",
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: {
        role: "admin",
        updatedAt: sql`now()`,
      },
    });
}
