import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import {
  buildTweaksDbPatch,
  type TweaksPatchBody,
} from "@/lib/api/tweak-requests";
import { upsertAppUser, type SessionUser } from "@/lib/auth/session";
import { type Tweaks } from "@/lib/tweaks";

export type TweaksRoutePayload = {
  tweaks: Partial<Tweaks> | null;
  watchlist: string[] | null;
};

type SaveTweaksRouteResult =
  | { ok: true }
  | { ok: false; error: "empty_body"; status: 400 };

export async function getTweaksRoutePayload(
  user: SessionUser,
): Promise<TweaksRoutePayload> {
  await upsertAppUser(user);

  const [row] = await db()
    .select({ tweaks: users.tweaks, watchlist: users.watchlist })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  return {
    tweaks: (row?.tweaks as Partial<Tweaks> | null) ?? null,
    watchlist: (row?.watchlist as string[] | null) ?? null,
  };
}

export async function saveTweaksRoutePayload(
  user: SessionUser,
  body: TweaksPatchBody,
): Promise<SaveTweaksRouteResult> {
  const patch = buildTweaksDbPatch(body);
  if (!patch) return { ok: false, error: "empty_body", status: 400 };

  await upsertAppUser(user);
  await db().update(users).set(patch).where(eq(users.id, user.id));
  return { ok: true };
}
