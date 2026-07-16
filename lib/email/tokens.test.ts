import { describe, expect, test } from "bun:test";
import { randomToken } from "@/lib/email/tokens";

describe("randomToken", () => {
  test("is base64url (URL-safe, no padding) and 43 chars for 32 bytes", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("does not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(randomToken());
    }
    expect(seen.size).toBe(200);
  });
});
