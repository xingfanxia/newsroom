import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { parseJsonRequestBody } from "@/lib/api/json-body";
import {
  buildTweaksDbPatch,
  tweaksPatchBodySchema,
} from "@/lib/api/tweak-requests";
import { requireSessionForRoute } from "@/lib/api/session-auth";
import { upsertAppUser } from "@/lib/auth/session";

/** GET — return the user's saved tweaks + watchlist (null when not set). */
export async function GET() {
  const auth = await requireSessionForRoute();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  await upsertAppUser(user);

  const [row] = await db()
    .select({ tweaks: users.tweaks, watchlist: users.watchlist })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  return NextResponse.json({
    ok: true,
    tweaks: row?.tweaks ?? null,
    watchlist: (row?.watchlist as string[] | null) ?? null,
  });
}

/** PATCH — save the user's tweaks / watchlist. Either field is optional. */
export async function PATCH(req: Request) {
  const auth = await requireSessionForRoute();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  await upsertAppUser(user);

  const parsed = await parseJsonRequestBody(req, tweaksPatchBodySchema, {
    envelope: "ok",
  });
  if (!parsed.ok) return parsed.response;

  const patch = buildTweaksDbPatch(parsed.data);
  if (!patch) {
    return NextResponse.json({ ok: false, error: "empty_body" }, { status: 400 });
  }

  await db().update(users).set(patch).where(eq(users.id, user.id));
  return NextResponse.json({ ok: true });
}
