import { describe, expect, it } from "bun:test";
import { NAV_ADMIN, NAV_PRIMARY, activeNavId } from "@/lib/shell/nav-data";

describe("activeNavId", () => {
  it("matches the root path as hot", () => {
    expect(activeNavId("/en")).toBe("hot");
    expect(activeNavId("/zh")).toBe("hot");
    expect(activeNavId("/en/")).toBe("hot");
  });

  it("matches exact top-level routes", () => {
    expect(activeNavId("/en/saved")).toBe("saved");
    expect(activeNavId("/zh/saved")).toBe("saved");
    expect(activeNavId("/en/sources")).toBe("sources");
    expect(activeNavId("/en/podcasts")).toBe("podcasts");
    expect(activeNavId("/en/low-follower")).toBe("lowfollow");
    expect(activeNavId("/en/x-monitor")).toBe("xmonitor");
    expect(activeNavId("/en/all")).toBe("all");
  });

  it("matches admin routes", () => {
    expect(activeNavId("/en/admin/system")).toBe("system");
    expect(activeNavId("/en/admin/iterations")).toBe("iterations");
    expect(activeNavId("/en/admin/usage")).toBe("usage");
    expect(activeNavId("/en/admin/policy")).toBe("policy");
    expect(activeNavId("/en/admin/users")).toBe("users");
  });

  it("matches nested routes via prefix (e.g. /podcasts/123)", () => {
    expect(activeNavId("/en/podcasts/42")).toBe("podcasts");
    expect(activeNavId("/zh/podcasts/7/transcript")).toBe("podcasts");
  });

  it("falls back to 'hot' for unknown paths rather than null", () => {
    expect(activeNavId("/en/something-new")).toBe("hot");
    expect(activeNavId("/")).toBe("hot");
  });

  it("handles locale-less paths gracefully", () => {
    // Non-locale-prefixed path shouldn't throw — consumer passes full pathname,
    // strip behaviour is best-effort. Unknown → 'hot' via the fallback.
    expect(() => activeNavId("/somewhere")).not.toThrow();
  });
});

describe("nav data shape", () => {
  it("exposes 7 primary nav items", () => {
    expect(NAV_PRIMARY).toHaveLength(7);
  });

  it("exposes 5 admin nav items (including the new usage route)", () => {
    expect(NAV_ADMIN).toHaveLength(5);
    expect(NAV_ADMIN.find((n) => n.id === "usage")).toBeDefined();
  });

  it("every nav item has bilingual labels", () => {
    for (const n of [...NAV_PRIMARY, ...NAV_ADMIN]) {
      expect(n.label.length).toBeGreaterThan(0);
      expect(n.cjk.length).toBeGreaterThan(0);
      expect(n.id.length).toBeGreaterThan(0);
    }
  });

  it("every nav href starts with /", () => {
    for (const n of [...NAV_PRIMARY, ...NAV_ADMIN]) {
      expect(n.href.startsWith("/")).toBe(true);
    }
  });
});
