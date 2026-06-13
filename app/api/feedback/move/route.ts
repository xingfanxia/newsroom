import { z } from "zod";
import { parseJsonRequestBody } from "@/lib/api/json-body";
import {
  runSessionRoute,
  sessionError,
  sessionOk,
  sessionServerError,
} from "@/lib/api/session-route";
import { upsertAppUser } from "@/lib/auth/session";
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
  return runSessionRoute(async (user) => {
    await upsertAppUser(user);

    const parsed = await parseJsonRequestBody(req, bodySchema, { envelope: "ok" });
    if (!parsed.ok) return parsed.response;

    try {
      const ok = await moveItemToCollection({
        userId: user.id,
        itemId: parsed.data.itemId,
        targetCollectionId: parsed.data.targetCollectionId,
      });
      if (!ok) return sessionError("not_found", 404);
      return sessionOk();
    } catch (err) {
      return sessionServerError("api/feedback/move", err);
    }
  });
}
