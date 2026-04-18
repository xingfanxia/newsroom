import { describe, expect, it } from "bun:test";
import { decideAdminGate } from "@/lib/auth/admin-gate";

describe("decideAdminGate — non-admin paths", () => {
  it("allows the home page for anonymous requests", () => {
    expect(decideAdminGate({ pathname: "/zh", hasSession: false })).toEqual({
      action: "allow",
    });
  });

  it("allows /zh/sources for anonymous requests", () => {
    expect(
      decideAdminGate({ pathname: "/zh/sources", hasSession: false }),
    ).toEqual({ action: "allow" });
  });

  it("allows /en/podcasts for anonymous requests", () => {
    expect(
      decideAdminGate({ pathname: "/en/podcasts", hasSession: false }),
    ).toEqual({ action: "allow" });
  });

  it("does NOT fire on /admin (missing locale prefix)", () => {
    // next-intl would rewrite this to /zh/admin but the gate runs pre-rewrite.
    expect(
      decideAdminGate({ pathname: "/admin", hasSession: false }),
    ).toEqual({ action: "allow" });
  });
});

describe("decideAdminGate — unauthenticated on admin paths", () => {
  it("redirects /zh/admin/iterations to /zh/login?next=…", () => {
    const d = decideAdminGate({
      pathname: "/zh/admin/iterations",
      hasSession: false,
    });
    expect(d).toEqual({
      action: "redirect",
      to: "/zh/login?next=%2Fzh%2Fadmin%2Fiterations",
    });
  });

  it("redirects /en/admin/system to /en/login with next= param", () => {
    const d = decideAdminGate({
      pathname: "/en/admin/system",
      hasSession: false,
    });
    expect(d).toEqual({
      action: "redirect",
      to: "/en/login?next=%2Fen%2Fadmin%2Fsystem",
    });
  });

  it("redirects the bare /zh/admin too (no trailing slash)", () => {
    const d = decideAdminGate({ pathname: "/zh/admin", hasSession: false });
    expect(d).toEqual({
      action: "redirect",
      to: "/zh/login?next=%2Fzh%2Fadmin",
    });
  });
});

describe("decideAdminGate — authenticated", () => {
  it("allows any admin path when hasSession=true", () => {
    expect(
      decideAdminGate({ pathname: "/zh/admin", hasSession: true }),
    ).toEqual({ action: "allow" });
    expect(
      decideAdminGate({
        pathname: "/en/admin/iterations",
        hasSession: true,
      }),
    ).toEqual({ action: "allow" });
  });
});
