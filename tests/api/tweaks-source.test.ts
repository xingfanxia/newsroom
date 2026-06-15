import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

const cookieRoute = read("app/api/tweaks/route.ts");
const v1Route = read("app/api/v1/tweaks/route.ts");
const sharedRouteHelper = read("lib/api/tweak-routes.ts");
const hook = read("hooks/use-tweaks.tsx");
const rightRail = read("components/feed/right-rail.tsx");

describe("tweaks route source wiring", () => {
  test("cookie and v1 routes share request validation", () => {
    for (const source of [cookieRoute, v1Route]) {
      expect(source).toContain("@/lib/api/tweak-requests");
      expect(source).toContain("tweaksPatchBodySchema");
      expect(source).not.toContain("const tweaksSchema = z.object");
      expect(source).not.toContain("const tweaksShape = z.object");
      expect(source).not.toContain("const bodySchema = z.object");
      expect(source).not.toContain("const patchSchema = z.object");
      expect(source).not.toContain("const patch: Record<string, unknown>");
    }
  });

  test("cookie and v1 routes share tweaks persistence payload helpers", () => {
    expect(sharedRouteHelper).toContain("buildTweaksDbPatch");
    expect(sharedRouteHelper).toContain("upsertAppUser");
    expect(sharedRouteHelper).toContain("getTweaksRoutePayload");
    expect(sharedRouteHelper).toContain("saveTweaksRoutePayload");

    for (const source of [cookieRoute, v1Route]) {
      expect(source).toContain("@/lib/api/tweak-routes");
      expect(source).not.toContain("buildTweaksDbPatch");
      expect(source).not.toContain("@/db/client");
      expect(source).not.toContain("@/db/schema");
      expect(source).not.toContain("upsertAppUser");
      expect(source).not.toContain(".update(users)");
      expect(source).not.toContain(".select({ tweaks:");
    }
  });

  test("cookie route wraps persistence failures in the shared session error envelope", () => {
    expect(cookieRoute).toContain("sessionServerError");
    expect(cookieRoute).toContain("sessionRouteResult(");
    expect(cookieRoute).not.toContain("sessionError(result.error");
    expect(cookieRoute).toContain('sessionServerError("api/tweaks GET", err)');
    expect(cookieRoute).toContain('sessionServerError("api/tweaks PATCH", err)');
  });

  test("client tweaks state uses the same source-of-truth defaults as API schemas", () => {
    expect(hook).toContain("@/lib/tweaks");
    expect(hook).not.toContain('density: "compact" | "comfy" | "reader"');
    expect(hook).not.toContain('accent: "green" | "blue"');
  });

  test("client tweaks server sync is debounced off the hot mutation path", () => {
    expect(hook).toContain("TWEAKS_SERVER_SYNC_DEBOUNCE_MS");
    expect(hook).toContain("pendingServerTweaksRef");
    expect(hook).toContain("window.setTimeout");
    expect(hook).toContain("window.clearTimeout");
  });

  test("right rail watchlist shares API normalization helpers", () => {
    expect(rightRail).toContain("@/lib/watchlist");
    expect(rightRail).toContain("addWatchlistTerm");
    expect(rightRail).toContain("removeWatchlistTerm");
    expect(rightRail).toContain("limitWatchlist");
    expect(rightRail).not.toContain("terms.includes");
    expect(rightRail).not.toContain(".slice(0, 24)");
  });
});
