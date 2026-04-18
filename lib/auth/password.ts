/**
 * Password-gate session. Replaces the earlier Supabase magic-link flow with
 * a single shared password stored in `ADMIN_PASSWORD` env. On successful
 * password submit we set a signed cookie; presence of a valid cookie =
 * admin session.
 *
 * Signature scheme: cookie value is `<expiry>.<hex(hmac-sha256(expiry, ADMIN_PASSWORD))>`.
 * Using the password itself as the HMAC key means a password rotation
 * automatically invalidates all outstanding cookies — no separate session
 * secret to manage.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "ax_admin";
/** 30-day rolling session — re-issued on every authenticated request. */
export const ADMIN_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function getPassword(): string {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) {
    throw new Error(
      "ADMIN_PASSWORD env is not set — admin gate is non-functional",
    );
  }
  return pw;
}

function sign(payload: string): string {
  return createHmac("sha256", getPassword()).update(payload).digest("hex");
}

/** Compare user-submitted password against the env, constant-time. */
export function isValidPassword(candidate: string): boolean {
  const expected = Buffer.from(getPassword(), "utf8");
  const given = Buffer.from(candidate ?? "", "utf8");
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/** Build a fresh signed cookie value that expires ADMIN_SESSION_MAX_AGE_SECONDS from now. */
export function mintSessionCookie(): string {
  const expiresMs = Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000;
  const payload = String(expiresMs);
  return `${payload}.${sign(payload)}`;
}

/** True when the cookie value is well-formed, unexpired, and HMAC matches. */
export function verifySessionCookie(value: string | undefined | null): boolean {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return false;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expiresMs = Number(payload);
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) return false;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return false;
  }
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
