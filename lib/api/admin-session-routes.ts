import { NextResponse } from "next/server";
import { z } from "zod";
import {
  expiredAdminSessionCookie,
  freshAdminSessionCookie,
} from "@/lib/auth/password";

export const adminLoginBodySchema = z.object({
  password: z.string().min(1).max(256),
  next: z.string().max(2048).optional(),
});

export function adminLoginInvalidResponse(): Response {
  return NextResponse.json(
    { ok: false, error: "invalid" },
    { status: 401 },
  );
}

export function adminLoginSuccessResponse(rawNext: string | undefined): Response {
  const res = NextResponse.json({
    ok: true,
    next: sanitizeAdminNext(rawNext),
  });
  res.cookies.set(freshAdminSessionCookie());
  return res;
}

export function adminLogoutResponse(): Response {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(expiredAdminSessionCookie());
  return res;
}

/** Same rules as the old Supabase callback: allow only local non-API paths. */
export function sanitizeAdminNext(raw: string | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/api")) return "/";
  return raw;
}
