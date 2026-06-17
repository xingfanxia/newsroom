import { adminLoginResponse } from "@/lib/api/admin-session-routes";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/auth — exchange an admin password for a signed session
 * cookie. Rate-limiting is not enforced here (single-user site, no UI surface
 * exposes brute-force potential); add it if the admin surface grows beyond
 * one operator.
 *
 * - 200 { ok: true, next } on success; Set-Cookie header sets the session
 * - 400 invalid body (not JSON / missing password)
 * - 401 wrong password — never returns WHY, just "invalid"
 */
export async function POST(req: Request) {
  return adminLoginResponse(req);
}
