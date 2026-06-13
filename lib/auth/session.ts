/**
 * Admin session — cookie-based. After PR #password-auth-gate the browser UI
 * runs on a single shared admin password (ADMIN_PASSWORD) instead of Supabase
 * magic-link + per-user allowlist. Any valid session cookie is considered
 * admin; there is no reader / editor tier in the UI.
 *
 * API tokens can still carry their own user IDs. Feedback rows reference the
 * effective user row for FK integrity, so callers must upsert the user before
 * mutating user-owned data.
 */
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  ADMIN_SESSION_COOKIE,
  verifySessionCookie,
} from "./password";
import { USER_ADMIN_ROLE, USER_READER_ROLE } from "@/lib/types";

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
  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    store = await cookies();
  } catch {
    return null;
  }
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

async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Every authenticated session is admin in the password-gate model. */
export async function requireAdmin(): Promise<SessionUser> {
  return requireUser();
}

/** Ensures the effective app user row exists before FK-owned mutations. */
export async function upsertAppUser(
  user: Pick<SessionUser, "id" | "email" | "isAdmin">,
): Promise<void> {
  await db()
    .insert(schema.users)
    .values({
      id: user.id,
      email: user.email,
      role: user.isAdmin ? USER_ADMIN_ROLE : USER_READER_ROLE,
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: {
        email: user.email,
        role: user.isAdmin ? USER_ADMIN_ROLE : USER_READER_ROLE,
        updatedAt: sql`now()`,
      },
    });
}
