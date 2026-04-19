import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, upsertAppUser } from "@/lib/auth/session";
import { moveItemToCollection } from "@/lib/items/collections";

const bodySchema = z.object({
  itemId: z.number().int().positive(),
  targetCollectionId: z.number().int().positive().nullable(),
});

/**
 * POST /api/feedback/move — reparent a saved item into a named collection
 * (or back to inbox when targetCollectionId=null).
 *
 * 200 { ok:true } on success, 400 on invalid body, 401 if unauth,
 * 404 if the save doesn't exist for this user.
 */
export async function POST(req: Request) {
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
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const ok = await moveItemToCollection({
      userId: user.id,
      itemId: parsed.data.itemId,
      targetCollectionId: parsed.data.targetCollectionId,
    });
    if (!ok) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/feedback/move] failed", err);
    return NextResponse.json(
      { ok: false, error: "server_error" },
      { status: 500 },
    );
  }
}
