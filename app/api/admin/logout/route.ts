import { NextResponse } from "next/server";
import { expiredAdminSessionCookie } from "@/lib/auth/password";

export const dynamic = "force-dynamic";

/** POST /api/admin/logout — drop the admin session cookie. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(expiredAdminSessionCookie());
  return res;
}
