import { describe, expect, it } from "bun:test";
import {
  NAV_ADMIN,
  NAV_MOBILE_TABS,
  NAV_PRIMARY,
  activeNavId,
  navHrefForLocale,
} from "@/lib/shell/nav-data";

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
    expect(activeNavId("/en/curated")).toBe("curated");
    expect(activeNavId("/en/x-monitor")).toBe("xmonitor");
    expect(activeNavId("/en/all")).toBe("all");
    expect(activeNavId("/en/daily")).toBe("daily");
    expect(activeNavId("/zh/daily")).toBe("daily");
  });

  it("matches daily archive nested routes via prefix", () => {
    expect(activeNavId("/zh/daily/2026-04-25")).toBe("daily");
    expect(activeNavId("/zh/daily/archive")).toBe("daily");
  });

  it("matches admin routes", () => {
    expect(activeNavId("/en/admin/system")).toBe("system");
    expect(activeNavId("/en/admin/newsletter")).toBe("newsletter-admin");
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

  it("does not treat locale-like non-prefixes as locales", () => {
    expect(activeNavId("/english/saved")).toBe("hot");
    expect(activeNavId("/zhishiku/saved")).toBe("hot");
  });
});

describe("nav data shape", () => {
  it("exposes 10 primary nav items without a papers tab", () => {
    expect(NAV_PRIMARY).toHaveLength(10);
    expect(NAV_PRIMARY.find((n) => n.id === "papers")).toBeUndefined();
    expect(NAV_PRIMARY.find((n) => n.id === "daily")).toBeDefined();
    expect(NAV_PRIMARY.find((n) => n.id === "newsletter")).toBeDefined();
  });

  it("exposes 6 admin nav items (including the new usage route)", () => {
    expect(NAV_ADMIN).toHaveLength(6);
    expect(NAV_ADMIN.find((n) => n.id === "usage")).toBeDefined();
    expect(NAV_ADMIN.find((n) => n.id === "newsletter-admin")).toBeDefined();
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

  it("derives mobile tabs from primary nav where possible", () => {
    const primaryById = new Map(NAV_PRIMARY.map((navItem) => [navItem.id, navItem]));
    expect(NAV_MOBILE_TABS.map((tab) => tab.id)).toEqual([
      "hot",
      "xmonitor",
      "radar",
      "saved",
      "more",
    ]);
    for (const id of ["hot", "xmonitor", "saved"]) {
      expect(NAV_MOBILE_TABS.find((tab) => tab.id === id)?.href).toBe(
        primaryById.get(id)?.href,
      );
    }
    expect(NAV_MOBILE_TABS.find((tab) => tab.id === "hot")?.label).toBe("feed");
    expect(NAV_MOBILE_TABS.find((tab) => tab.id === "xmonitor")?.cjk).toBe(
      "监控",
    );
  });

  it("builds locale-prefixed nav hrefs in one helper", () => {
    expect(navHrefForLocale("zh", "/")).toBe("/zh");
    expect(navHrefForLocale("en", "/saved")).toBe("/en/saved");
    expect(navHrefForLocale("zh", "#")).toBe("#");
  });
});
