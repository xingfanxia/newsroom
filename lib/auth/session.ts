import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { createSupabaseServer } from "./supabase/server";
import { isAdminEmail } from "./config";

export type SessionUser = {
  id: string;
  email: string;
  /** True when email ∈ ALLOWED_ADMIN_EMAILS. Computed once per request. */
  isAdmin: boolean;
};

/**
 * Reads the current session via Supabase. Returns null when the user is
 * unauthenticated, has no email (anonymous flows), or Supabase rejects the
 * token. Never throws — callers decide what to do with null.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.email) return null;
  return {
    id: user.id,
    email: user.email,
    isAdmin: isAdminEmail(user.email),
  };
}

/**
 * Like {@link getSessionUser} but throws an `UnauthorizedError` when no
 * session is present. Use in Route Handlers / Server Actions that require
 * authentication. Translate to a 401 response at the boundary.
 */
export class UnauthorizedError extends Error {
  constructor(message = "authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/**
 * Ensures a row exists in our app-level `users` table for the Supabase auth
 * user. Idempotent — safe to call on every authenticated request.
 *
 * Updates email + updatedAt on conflict so a user changing their email in
 * Supabase auth propagates into our table on their next action.
 */
export async function upsertAppUser(
  user: Pick<SessionUser, "id" | "email" | "isAdmin">,
): Promise<void> {
  await db()
    .insert(schema.users)
    .values({
      id: user.id,
      email: user.email,
      role: user.isAdmin ? "admin" : "reader",
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: {
        email: user.email,
        role: user.isAdmin ? "admin" : "reader",
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Fetches the app-level role from the `users` table. Falls back to "reader"
 * when the row is missing — callers that need stronger guarantees should
 * combine with {@link upsertAppUser}.
 */
export async function getAppRole(
  userId: string,
): Promise<"admin" | "editor" | "reader"> {
  const rows = await db()
    .select({ role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return rows[0]?.role ?? "reader";
}
