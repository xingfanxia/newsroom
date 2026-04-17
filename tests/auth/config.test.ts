import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { allowedAdminEmails, isAdminEmail } from "@/lib/auth/config";

const ORIGINAL = process.env.ALLOWED_ADMIN_EMAILS;

function setEnv(value: string | undefined) {
  if (value === undefined) {
    delete process.env.ALLOWED_ADMIN_EMAILS;
  } else {
    process.env.ALLOWED_ADMIN_EMAILS = value;
  }
}

describe("allowedAdminEmails", () => {
  beforeEach(() => setEnv(undefined));
  afterEach(() => setEnv(ORIGINAL));

  it("defaults to the owner email when env is unset (fail-closed)", () => {
    expect(allowedAdminEmails()).toEqual(["xingfanxia@gmail.com"]);
  });

  it("parses a single email with surrounding whitespace", () => {
    setEnv("  foo@bar.com  ");
    expect(allowedAdminEmails()).toEqual(["foo@bar.com"]);
  });

  it("parses a comma-separated list and lowercases", () => {
    setEnv("Admin@Example.com, Ops@Example.com ");
    expect(allowedAdminEmails()).toEqual([
      "admin@example.com",
      "ops@example.com",
    ]);
  });

  it("falls back to owner when env is an empty string (fail-closed)", () => {
    setEnv("");
    expect(allowedAdminEmails()).toEqual(["xingfanxia@gmail.com"]);
  });

  it("falls back to owner when env is only commas / whitespace", () => {
    setEnv(" , , ,");
    expect(allowedAdminEmails()).toEqual(["xingfanxia@gmail.com"]);
  });
});

describe("isAdminEmail", () => {
  beforeEach(() => setEnv("admin@example.com, ops@example.com"));
  afterEach(() => setEnv(ORIGINAL));

  it("returns false for null / undefined / empty email", () => {
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail("")).toBe(false);
  });

  it("returns true for an allowed email (case-insensitive)", () => {
    expect(isAdminEmail("admin@example.com")).toBe(true);
    expect(isAdminEmail("ADMIN@example.com")).toBe(true);
    expect(isAdminEmail("  ops@example.com  ")).toBe(true);
  });

  it("returns false for a non-allowed email", () => {
    expect(isAdminEmail("random@example.com")).toBe(false);
  });
});
