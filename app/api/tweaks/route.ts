import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import {
  buildTweaksDbPatch,
  tweaksPatchBodySchema,
} from "@/lib/api/tweak-requests";
import { getSessionUser, upsertAppUser } from "@/lib/auth/session";

/** GET — return the user's saved tweaks + watchlist (null when not set). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }
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
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }
  await upsertAppUser(user);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = tweaksPatchBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const patch = buildTweaksDbPatch(parsed.data);
  if (!patch) {
    return NextResponse.json({ ok: false, error: "empty_body" }, { status: 400 });
  }

  await db().update(users).set(patch).where(eq(users.id, user.id));
  return NextResponse.json({ ok: true });
}
