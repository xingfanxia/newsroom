import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { decideAdminGate } from "@/lib/auth/admin-gate";

const ORIGINAL = process.env.ALLOWED_ADMIN_EMAILS;

function setEnv(value: string | undefined) {
  if (value === undefined) {
    delete process.env.ALLOWED_ADMIN_EMAILS;
  } else {
    process.env.ALLOWED_ADMIN_EMAILS = value;
  }
}

describe("decideAdminGate — non-admin paths", () => {
  beforeEach(() => setEnv("admin@example.com"));
  afterEach(() => setEnv(ORIGINAL));

  it("allows the home page for anonymous users", () => {
    expect(decideAdminGate({ pathname: "/zh", user: null })).toEqual({
      action: "allow",
    });
  });

  it("allows /zh/sources for anonymous users", () => {
    expect(decideAdminGate({ pathname: "/zh/sources", user: null })).toEqual({
      action: "allow",
    });
  });

  it("allows /en/podcasts for anonymous users", () => {
    expect(decideAdminGate({ pathname: "/en/podcasts", user: null })).toEqual({
      action: "allow",
    });
  });

  it("does NOT fire on /admin (missing locale prefix)", () => {
    // next-intl would rewrite this to /zh/admin but the gate runs pre-rewrite.
    // Either way we default to allow so paths that don't yet have a locale
    // get handled by next-intl routing instead of the gate.
    expect(decideAdminGate({ pathname: "/admin", user: null })).toEqual({
      action: "allow",
    });
  });
});

describe("decideAdminGate — unauthenticated on admin paths", () => {
  beforeEach(() => setEnv("admin@example.com"));
  afterEach(() => setEnv(ORIGINAL));

  it("redirects /zh/admin/iterations to /zh/login?next=...", () => {
    const d = decideAdminGate({
      pathname: "/zh/admin/iterations",
      user: null,
    });
    expect(d).toEqual({
      action: "redirect",
      to: "/zh/login?next=%2Fzh%2Fadmin%2Fiterations",
    });
  });

  it("redirects /en/admin/system to /en/login with next= param", () => {
    const d = decideAdminGate({
      pathname: "/en/admin/system",
      user: null,
    });
    expect(d).toEqual({
      action: "redirect",
      to: "/en/login?next=%2Fen%2Fadmin%2Fsystem",
    });
  });

  it("redirects the bare /zh/admin too (no trailing slash)", () => {
    const d = decideAdminGate({ pathname: "/zh/admin", user: null });
    expect(d).toEqual({
      action: "redirect",
      to: "/zh/login?next=%2Fzh%2Fadmin",
    });
  });
});

describe("decideAdminGate — authenticated on admin paths", () => {
  beforeEach(() => setEnv("admin@example.com"));
  afterEach(() => setEnv(ORIGINAL));

  it("allows an admin email", () => {
    const d = decideAdminGate({
      pathname: "/zh/admin/iterations",
      user: { email: "admin@example.com" },
    });
    expect(d).toEqual({ action: "allow" });
  });

  it("redirects a non-admin email to /403", () => {
    const d = decideAdminGate({
      pathname: "/zh/admin/iterations",
      user: { email: "random@example.com" },
    });
    expect(d).toEqual({ action: "redirect", to: "/zh/403" });
  });

  it("is case-insensitive on the allowlist match", () => {
    const d = decideAdminGate({
      pathname: "/zh/admin",
      user: { email: "ADMIN@example.com" },
    });
    expect(d).toEqual({ action: "allow" });
  });

  it("treats a user with no email as forbidden", () => {
    const d = decideAdminGate({
      pathname: "/zh/admin/users",
      user: { email: null },
    });
    expect(d).toEqual({ action: "redirect", to: "/zh/403" });
  });
});

describe("decideAdminGate — fail-closed default", () => {
  beforeEach(() => setEnv(undefined));
  afterEach(() => setEnv(ORIGINAL));

  it("without ALLOWED_ADMIN_EMAILS env, only the owner email passes", () => {
    const owner = decideAdminGate({
      pathname: "/zh/admin",
      user: { email: "xingfanxia@gmail.com" },
    });
    expect(owner).toEqual({ action: "allow" });

    const other = decideAdminGate({
      pathname: "/zh/admin",
      user: { email: "someone@else.com" },
    });
    expect(other).toEqual({ action: "redirect", to: "/zh/403" });
  });
});
