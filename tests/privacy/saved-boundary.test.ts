import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import {
  loadSavedPageRequest,
  type SavedPageDependencies,
} from "@/lib/auth/saved-page-boundary";
import { GET as exportSaved } from "@/app/api/saved/export/route";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import proxy from "@/proxy";
import { NextRequest } from "next/server";
import { sessionIdentityFromCookie } from "@/lib/auth/session-identity";
import { mintSessionCookie } from "@/lib/auth/password";
import { decideProtectedSessionGate } from "@/lib/auth/admin-gate";
import { readSource, sourcePath } from "@/tests/helpers/source";

const ORIGINAL_PASSWORD = process.env.ADMIN_PASSWORD;

function resolveLocalImport(importer: string, specifier: string): string | null {
  const stem = specifier.startsWith("@/")
    ? specifier.slice(2)
    : specifier.startsWith(".")
      ? normalize(join(dirname(importer), specifier))
      : null;
  if (!stem) return null;

  for (const candidate of [
    `${stem}.ts`,
    `${stem}.tsx`,
    join(stem, "index.ts"),
    join(stem, "index.tsx"),
  ]) {
    if (existsSync(sourcePath(candidate))) return candidate;
  }
  return null;
}

function localImportClosure(entry: string): string[] {
  const pending = [entry];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop();
    if (!path || visited.has(path)) continue;
    visited.add(path);
    const source = readSource(path);
    const specifiers = [
      ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
      ...source.matchAll(/\bimport\s+["']([^"']+)["']/g),
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
      const dependency = resolveLocalImport(path, specifier);
      if (dependency && !visited.has(dependency)) pending.push(dependency);
    }
  }
  return [...visited].sort();
}

describe("saved-data privacy boundary", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "saved-boundary-test-password";
  });

  afterEach(() => {
    if (ORIGINAL_PASSWORD === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = ORIGINAL_PASSWORD;
  });

  test("cookie-only identity parsing is shared without importing the database", () => {
    expect(sessionIdentityFromCookie(undefined)).toBeNull();
    expect(sessionIdentityFromCookie(mintSessionCookie())).toMatchObject({
      id: "admin-local",
      email: "admin@local",
      isAdmin: true,
    });

    const identitySource = readSource("lib/auth/session-identity.ts");
    const proxySource = readSource("proxy.ts");
    expect(identitySource).toContain("ADMIN_SESSION_COOKIE");
    expect(identitySource).not.toContain("@/db/client");
    expect(proxySource).toContain("@/lib/auth/session-identity");
    expect(proxySource).not.toMatch(
      /from ["']@\/lib\/auth\/session["']/,
    );
    expect(proxySource).not.toContain("@/db/client");
  });

  test("proxy identity dependency closure stays database-free", () => {
    const localIdentityClosure = localImportClosure("proxy.ts");
    expect(localIdentityClosure).toEqual(
      expect.arrayContaining([
        "proxy.ts",
        "lib/auth/session-identity.ts",
        "lib/auth/password.ts",
        "lib/auth/admin-gate.ts",
        "i18n/routing.ts",
        "lib/types.ts",
      ]),
    );

    for (const path of localIdentityClosure) {
      expect(path).not.toMatch(/(?:^|\/)db(?:\/|$)/);
      expect(path).not.toBe("lib/auth/session.ts");
    }
  });

  test("optimistic proxy gate protects locale-aware saved paths", () => {
    expect(
      decideProtectedSessionGate({ pathname: "/en/saved", hasSession: false }),
    ).toEqual({
      action: "redirect",
      to: "/en/login?next=%2Fen%2Fsaved",
    });
    expect(
      decideProtectedSessionGate({
        pathname: "/zh/saved/queue",
        hasSession: false,
      }),
    ).toEqual({
      action: "redirect",
      to: "/zh/login?next=%2Fzh%2Fsaved%2Fqueue",
    });
    expect(
      decideProtectedSessionGate({ pathname: "/en/saved", hasSession: true }),
    ).toEqual({ action: "allow" });
  });

  test("actual proxy redirects saved, preserves locale routing, and avoids false positives", async () => {
    const saved = await proxy(
      new NextRequest("https://news.ax0x.ai/en/saved"),
    );
    expect(saved.status).toBe(307);
    expect(saved.headers.get("location")).toBe(
      "https://news.ax0x.ai/en/login?next=%2Fen%2Fsaved",
    );

    const unprefixed = await proxy(
      new NextRequest("https://news.ax0x.ai/saved"),
    );
    expect(unprefixed.status).toBe(307);
    expect(unprefixed.headers.get("location")).toBe(
      "https://news.ax0x.ai/zh/saved",
    );

    const falsePositive = await proxy(
      new NextRequest("https://news.ax0x.ai/en/savedness"),
    );
    expect(falsePositive.status).toBe(200);
    expect(falsePositive.headers.get("location")).toBeNull();
  });

  test("saved page delegates all body loading through the hard boundary", () => {
    const pageSource = readSource("app/[locale]/saved/page.tsx");
    const boundarySource = readSource("lib/auth/saved-page-boundary.ts");
    const hardGate = boundarySource.indexOf("if (!user) {");
    expect(pageSource).not.toContain("ADMIN_USER_ID");
    expect(pageSource).toContain(
      "loadSavedPageRequest(props, savedPageDependencies)",
    );
    expect(hardGate).toBeGreaterThan(-1);
    expect(hardGate).toBeLessThan(boundarySource.indexOf("await searchParams"));
    expect(hardGate).toBeLessThan(
      boundarySource.indexOf("await dependencies.upsertAppUser"),
    );
  });

  test("anonymous page seam calls none of the saved-data body dependencies", async () => {
    const calls: string[] = [];
    let searchParamsTouched = false;
    const poisonSearchParams = Object.defineProperty({}, "then", {
      get() {
        searchParamsTouched = true;
        throw new Error("search params must not be awaited");
      },
    }) as Promise<{ collection?: string }>;
    const forbidden = (name: string) => async () => {
      calls.push(name);
      throw new Error(`${name} must not run`);
    };
    const forbiddenSync = (name: string) => () => {
      calls.push(name);
      throw new Error(`${name} must not run`);
    };
    const dependencies: SavedPageDependencies = {
      getSessionUser: async () => {
        calls.push("getSessionUser");
        return null;
      },
      upsertAppUser: forbidden("upsertAppUser"),
      listCollections: forbidden("listCollections"),
      getInboxCount: forbidden("getInboxCount"),
      getSavedTotals: forbidden("getSavedTotals"),
      getShellChromeData: forbidden("getShellChromeData"),
      getSavedStories: forbidden("getSavedStories"),
      getSavedTags: forbidden("getSavedTags"),
      setRequestLocale: forbiddenSync("setRequestLocale"),
      redirect: (destination) => {
        calls.push(`redirect:${destination}`);
        throw new Error("anonymous_saved_redirect");
      },
    };

    await expect(
      loadSavedPageRequest(
        {
          params: Promise.resolve({ locale: "zh" }),
          searchParams: poisonSearchParams,
        },
        dependencies,
      ),
    ).rejects.toThrow("anonymous_saved_redirect");

    expect(calls).toEqual([
      "getSessionUser",
      "redirect:/zh/login?next=%2Fzh%2Fsaved",
    ]);
    expect(searchParamsTouched).toBe(false);
    for (const dependency of [
      "upsertAppUser",
      "listCollections",
      "getInboxCount",
      "getSavedTotals",
      "getShellChromeData",
      "getSavedStories",
      "getSavedTags",
    ]) {
      expect(calls).not.toContain(dependency);
    }
  });

  test("authenticated page seam preserves locale-aware saved loading", async () => {
    const calls: string[] = [];
    const user = { id: "admin-local", email: "admin@local", isAdmin: true };
    const dependencies: SavedPageDependencies = {
      getSessionUser: async () => user,
      upsertAppUser: async (value) => {
        calls.push(`upsert:${value.id}`);
      },
      listCollections: async (userId) => {
        calls.push(`collections:${userId}`);
        return [
          {
            id: 7,
            name: "Research",
            nameCjk: "研究",
            pinned: false,
            sortOrder: 0,
            count: 1,
            createdAt: "2026-07-14T00:00:00.000Z",
          },
        ];
      },
      getInboxCount: async () => 2,
      getSavedTotals: async () => ({ total: 3, thisWeek: 2, thisMonth: 3 }),
      getShellChromeData: async () => ({
        radarStats: {
          items_today: 0,
          items_p1: 0,
          items_featured: 0,
          tracked_sources: 0,
        },
        topBarStats: { tracked_sources: 0, signal_ratio: 0 },
        pulse: [],
      }),
      getSavedStories: async (_userId, locale, opts) => {
        calls.push(`stories:${locale}:${opts.collection}`);
        return [];
      },
      getSavedTags: async (_userId, opts) => {
        calls.push(`tags:${opts.collection}`);
        return [];
      },
      setRequestLocale: (locale) => {
        calls.push(`locale:${locale}`);
      },
      redirect: (destination) => {
        throw new Error(`unexpected redirect: ${destination}`);
      },
    };

    const result = await loadSavedPageRequest(
      {
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({ collection: "7" }),
      },
      dependencies,
    );

    expect(result).toMatchObject({
      appLocale: "en",
      activeId: 7,
      inboxCount: 2,
      totals: { total: 3, thisWeek: 2, thisMonth: 3 },
    });
    expect(calls).toEqual([
      "locale:en",
      "upsert:admin-local",
      "collections:admin-local",
      "stories:en:7",
      "tags:7",
    ]);
  });

  test("anonymous saved export returns 401 without touching request body logic", async () => {
    const poisonRequest = new Proxy(
      new Request("https://example.test/api/saved/export"),
      {
        get() {
          throw new Error("saved export body executed before authorization");
        },
      },
    );

    const response = await exportSaved(poisonRequest);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "auth_required",
    });
  });

  test("saved pages are absent from sitemap and denied in robots", () => {
    const sitemapUrls = sitemap().map((entry) => new URL(entry.url).pathname);
    expect(sitemapUrls).not.toContain("/en/saved");
    expect(sitemapUrls).not.toContain("/zh/saved");

    const rules = robots().rules;
    expect(Array.isArray(rules)).toBe(true);
    const disallow = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) =>
      Array.isArray(rule.disallow)
        ? rule.disallow
        : rule.disallow
          ? [rule.disallow]
          : [],
    );
    expect(disallow).toContain("/saved");
    expect(disallow).toContain("/zh/saved");
    expect(disallow).toContain("/en/saved");
  });
});
