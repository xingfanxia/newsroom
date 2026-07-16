import { randomBytes } from "node:crypto";

/**
 * 32 bytes of CSPRNG entropy, base64url (43 chars, URL-safe, unpadded).
 * Used for confirm + unsubscribe tokens; stored plaintext (leak blast
 * radius = confirm/unsubscribe only — see PLAN.md §1.10).
 */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}
