/**
 * Auth configuration — env reading + admin-email allowlist.
 *
 * Fail-closed philosophy: when ALLOWED_ADMIN_EMAILS is unset we default to
 * the owner's address so prod can never accidentally expose /admin/*.
 */
const DEFAULT_OWNER_EMAIL = "xingfanxia@gmail.com";

export function supabaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!v) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set — link Supabase via Vercel Marketplace.",
    );
  }
  return v;
}

export function supabaseAnonKey(): string {
  const v =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!v) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) is not set.",
    );
  }
  return v;
}

/** Comma-separated list, trimmed and lowercased, defaulted to owner email. */
export function allowedAdminEmails(): readonly string[] {
  const raw = process.env.ALLOWED_ADMIN_EMAILS?.trim();
  if (!raw) return [DEFAULT_OWNER_EMAIL];
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : [DEFAULT_OWNER_EMAIL];
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowedAdminEmails().includes(email.trim().toLowerCase());
}
