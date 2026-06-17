import { z } from "zod";
import { parseJsonRequestBody } from "@/lib/api/json-body";
import { okEmpty, okError, okJson } from "@/lib/api/ok-response";
import {
  expiredAdminSessionCookie,
  freshAdminSessionCookie,
  isValidPassword,
} from "@/lib/auth/password";

export const adminLoginBodySchema = z.object({
  password: z.string().min(1).max(256),
  next: z.string().max(2048).optional(),
});

export function adminLoginInvalidResponse(): Response {
  return okError("invalid", 401);
}

export async function adminLoginResponse(req: Request): Promise<Response> {
  const parsed = await parseJsonRequestBody(req, adminLoginBodySchema, {
    envelope: "ok",
    includeIssues: false,
  });
  if (!parsed.ok) return parsed.response;

  if (!isValidPassword(parsed.data.password)) {
    return adminLoginInvalidResponse();
  }

  return adminLoginSuccessResponse(parsed.data.next);
}

export function adminLoginSuccessResponse(rawNext: string | undefined): Response {
  const res = okJson({
    next: sanitizeAdminNext(rawNext),
  });
  res.cookies.set(freshAdminSessionCookie());
  return res;
}

export function adminLogoutResponse(): Response {
  const res = okEmpty();
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
