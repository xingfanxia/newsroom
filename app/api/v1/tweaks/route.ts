/**
 * /api/v1/tweaks — Bearer-gated view + mutation of user preferences +
 * watchlist terms. Mirrors /api/tweaks (cookie-gated) for agents.
 *
 * GET    → { tweaks, watchlist }
 * PATCH  → body { tweaks?, watchlist? } — either field optional
 *
 * Watchlist: array of ≤24 strings, each 1..64 chars. Full replace semantic
 * (no partial deltas) to match the existing UI and make the agent's mental
 * model simple ("I sent [a,b,c] → server state is exactly [a,b,c]").
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import {
  buildTweaksDbPatch,
  tweaksPatchBodySchema,
} from "@/lib/api/tweak-requests";
import { parseJsonRequestBody } from "@/lib/api/json-body";
import {
  runV1Route,
  v1Error,
  v1Json,
  v1ServerError,
} from "@/lib/api/v1-route";
import { upsertAppUser } from "@/lib/auth/session";

export async function GET(req: Request) {
  return runV1Route(req, async (user) => {
    try {
      await upsertAppUser(user);
      const [row] = await db()
        .select({ tweaks: users.tweaks, watchlist: users.watchlist })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      return v1Json({
        tweaks: row?.tweaks ?? null,
        watchlist: (row?.watchlist as string[] | null) ?? null,
      });
    } catch (err) {
      return v1ServerError("api/v1/tweaks GET", err);
    }
  });
}

export async function PATCH(req: Request) {
  return runV1Route(req, async (user) => {
    const parsed = await parseJsonRequestBody(req, tweaksPatchBodySchema, {
      envelope: "plain",
    });
    if (!parsed.ok) return parsed.response;

    const patch = buildTweaksDbPatch(parsed.data);
    if (!patch) {
      return v1Error("empty_body", 400);
    }

    try {
      await upsertAppUser(user);
      await db().update(users).set(patch).where(eq(users.id, user.id));
      return v1Json({ ok: true });
    } catch (err) {
      return v1ServerError("api/v1/tweaks PATCH", err);
    }
  });
}
