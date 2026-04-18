import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  ADMIN_SESSION_MAX_AGE_SECONDS,
  isValidPassword,
  mintSessionCookie,
  verifySessionCookie,
} from "@/lib/auth/password";

const ORIGINAL = process.env.ADMIN_PASSWORD;

function setEnv(v: string | undefined) {
  if (v === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = v;
}

describe("isValidPassword", () => {
  beforeEach(() => setEnv("correct-pw"));
  afterEach(() => setEnv(ORIGINAL));

  it("accepts the exact password", () => {
    expect(isValidPassword("correct-pw")).toBe(true);
  });

  it("rejects the wrong password", () => {
    expect(isValidPassword("nope")).toBe(false);
  });

  it("rejects a password of a different length (timing-safe path)", () => {
    expect(isValidPassword("longer-wrong")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(isValidPassword("")).toBe(false);
  });
});

describe("session cookie round-trip", () => {
  beforeEach(() => setEnv("round-trip-pw"));
  afterEach(() => setEnv(ORIGINAL));

  it("verifies a freshly-minted cookie", () => {
    const cookie = mintSessionCookie();
    expect(verifySessionCookie(cookie)).toBe(true);
  });

  it("rejects tampered signature", () => {
    const cookie = mintSessionCookie();
    const [payload, sig] = cookie.split(".");
    const tampered = `${payload}.${"0".repeat(sig.length)}`;
    expect(verifySessionCookie(tampered)).toBe(false);
  });

  it("rejects tampered payload (different expiry)", () => {
    const cookie = mintSessionCookie();
    const [, sig] = cookie.split(".");
    const farFuture = String(Date.now() + 365 * 86400_000);
    expect(verifySessionCookie(`${farFuture}.${sig}`)).toBe(false);
  });

  it("rejects empty / malformed cookies", () => {
    expect(verifySessionCookie(undefined)).toBe(false);
    expect(verifySessionCookie("")).toBe(false);
    expect(verifySessionCookie("no-dot")).toBe(false);
    expect(verifySessionCookie(".dangling-sig")).toBe(false);
    expect(verifySessionCookie("payload.")).toBe(false);
  });

  it("rejects an expired payload", () => {
    // Build a cookie with payload in the past, manually signed with the same key.
    // We can reuse mintSessionCookie by first rewinding the clock via timer stub
    // — simpler: just craft an expired payload and HMAC it ourselves.
    const { createHmac } = require("node:crypto");
    const expired = String(Date.now() - 60_000);
    const sig = createHmac("sha256", "round-trip-pw")
      .update(expired)
      .digest("hex");
    expect(verifySessionCookie(`${expired}.${sig}`)).toBe(false);
  });

  it("rotating the password invalidates existing cookies", () => {
    const cookie = mintSessionCookie();
    setEnv("different-pw");
    expect(verifySessionCookie(cookie)).toBe(false);
  });

  it("ADMIN_SESSION_MAX_AGE_SECONDS is 30 days", () => {
    expect(ADMIN_SESSION_MAX_AGE_SECONDS).toBe(30 * 86400);
  });
});
