import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonRequestBody } from "@/lib/api/json-body";
import { upsertAppUser } from "@/lib/auth/session";
import { requireSessionForRoute } from "@/lib/api/session-auth";
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
  const auth = await requireSessionForRoute();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  await upsertAppUser(user);

  const parsed = await parseJsonRequestBody(req, bodySchema, { envelope: "ok" });
  if (!parsed.ok) return parsed.response;

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
