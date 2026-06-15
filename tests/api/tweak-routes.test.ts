import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { closeDb, db, schema } from "@/db/client";
import {
  getTweaksRoutePayload,
  saveTweaksRoutePayload,
} from "@/lib/api/tweak-routes";
import type { SessionUser } from "@/lib/auth/session";

const root = process.cwd();
const hasDb = Boolean(
  process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL,
);
const describeOrSkip = hasDb ? describe : describe.skip;

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("tweaks route payload source contract", () => {
  test("types the shared payload as a partial Tweaks contract", () => {
    const source = read("lib/api/tweak-routes.ts");

    expect(source).toContain('from "@/lib/tweaks"');
    expect(source).toContain("tweaks: Partial<Tweaks> | null;");
    expect(source).not.toContain("tweaks: unknown | null;");
  });
});

describeOrSkip("tweaks route payload helpers (real DB)", () => {
  const user: SessionUser = {
    id: `tweak-route-${crypto.randomUUID()}`,
    email: `tweak-route-${crypto.randomUUID()}@example.test`,
    isAdmin: false,
  };

  afterAll(async () => {
    await db().delete(schema.users).where(eq(schema.users.id, user.id));
    await closeDb();
  });

  test("round-trips GET and PATCH semantics through the shared helper", async () => {
    await expect(getTweaksRoutePayload(user)).resolves.toEqual({
      tweaks: null,
      watchlist: null,
    });

    await expect(saveTweaksRoutePayload(user, {})).resolves.toEqual({
      ok: false,
      error: "empty_body",
      status: 400,
    });

    await expect(
      saveTweaksRoutePayload(user, {
        tweaks: {
          accent: "cyan",
          language: "zh",
          showTicker: false,
        },
        watchlist: ["gpt-6", "agentic ide"],
      }),
    ).resolves.toEqual({ ok: true });

    await expect(getTweaksRoutePayload(user)).resolves.toEqual({
      tweaks: {
        accent: "cyan",
        language: "zh",
        showTicker: false,
      },
      watchlist: ["gpt-6", "agentic ide"],
    });

    await expect(
      saveTweaksRoutePayload(user, {
        watchlist: ["deepseek"],
      }),
    ).resolves.toEqual({ ok: true });

    await expect(getTweaksRoutePayload(user)).resolves.toEqual({
      tweaks: {
        accent: "cyan",
        language: "zh",
        showTicker: false,
      },
      watchlist: ["deepseek"],
    });
  });
});
