import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { closeDb, db, schema } from "@/db/client";
import {
  getTweaksRoutePayload,
  saveTweaksRoutePayload,
} from "@/lib/api/tweak-routes";
import type { SessionUser } from "@/lib/auth/session";
import { assertProductionIntegrationOptIn } from "@/scripts/verification/run-hermetic-tests";

assertProductionIntegrationOptIn();

describe("tweaks route payload helpers (real DB)", () => {
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
          showTicker: false,
        },
        watchlist: ["gpt-6", "agentic ide"],
      }),
    ).resolves.toEqual({ ok: true });

    await expect(getTweaksRoutePayload(user)).resolves.toEqual({
      tweaks: {
        accent: "cyan",
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
        showTicker: false,
      },
      watchlist: ["deepseek"],
    });
  });
});
