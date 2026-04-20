/**
 * Bearer-token auth for /api/v1/* endpoints.
 *
 * Tokens are 32 random bytes (256 bits of entropy, base64url-encoded at mint
 * time). We never persist the plaintext — only sha256(token) is stored in
 * api_tokens.token_hash, unique-indexed. Verification is therefore O(log n)
 * via the btree index, with no timing-attack concern: a 256-bit token can't
 * be brute-forced, so hash-lookup timing leaks nothing useful.
 *
 * Rotation = INSERT a new token row + UPDATE old row set revoked_at=now().
 * The token itself is immutable once minted; if the operator leaks one,
 * revoke it and mint a fresh one.
 */
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { apiTokens } from "@/db/schema";
import type { SessionUser } from "./session";

export const API_TOKEN_HEADER = "authorization";

/** Canonical hash — used at mint, at verify, never in logs. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Parse `Authorization: Bearer <token>` from a request. Returns the token
 * string on success, null if the header is missing or malformed.
 */
export function extractBearer(headers: Headers): string | null {
  const raw = headers.get(API_TOKEN_HEADER);
  if (!raw) return null;
  const match = /^Bearer\s+([A-Za-z0-9_\-]+)$/.exec(raw.trim());
  return match ? match[1] : null;
}

/**
 * Look up a raw bearer against api_tokens. Returns the owning user on hit,
 * null on miss / revoked. Bumps last_used_at as a fire-and-forget side
 * effect so we never block the request on the bookkeeping UPDATE.
 */
export async function verifyApiToken(
  token: string,
): Promise<SessionUser | null> {
  if (!token) return null;
  const hash = hashToken(token);
  const client = db();
  const [row] = await client
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hash))
    .limit(1);
  if (!row || row.revokedAt) return null;

  void client
    .update(apiTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(apiTokens.id, row.id))
    .catch((err) => {
      console.error("[api-token] last_used_at bump failed", err);
    });

  return {
    id: row.userId,
    email: "admin@local",
    isAdmin: true,
  };
}

/**
 * Route-handler helper. Returns either `{ user }` on success or a
 * ready-to-return 401 Response.
 */
export async function requireApiToken(
  req: Request,
): Promise<{ user: SessionUser } | Response> {
  const token = extractBearer(req.headers);
  if (!token) {
    return Response.json(
      {
        error: "missing_bearer",
        detail: "Authorization: Bearer <token> required",
      },
      { status: 401 },
    );
  }
  const user = await verifyApiToken(token);
  if (!user) {
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }
  return { user };
}
