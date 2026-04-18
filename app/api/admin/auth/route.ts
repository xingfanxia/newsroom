import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  isValidPassword,
  mintSessionCookie,
} from "@/lib/auth/password";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  password: z.string().min(1).max(256),
  next: z.string().max(2048).optional(),
});

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
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 },
    );
  }

  if (!isValidPassword(parsed.data.password)) {
    return NextResponse.json(
      { ok: false, error: "invalid" },
      { status: 401 },
    );
  }

  const res = NextResponse.json({
    ok: true,
    next: sanitiseNext(parsed.data.next),
  });
  res.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: mintSessionCookie(),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });
  return res;
}

/** Same rules as the old Supabase callback — block open-redirects. */
function sanitiseNext(raw: string | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/api")) return "/";
  return raw;
}
