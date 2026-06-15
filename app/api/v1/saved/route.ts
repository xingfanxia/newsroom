/**
 * GET  /api/v1/saved  — list the caller's saved items.
 * POST /api/v1/saved  — toggle the save slot for an item on/off.
 *
 * Both operations are thin wrappers around shared saved helpers so the
 * agent-facing and human-facing surfaces can never drift.
 *
 * Query params (GET):
 *   collection = <id> | inbox (omitted = all)
 *   limit      = 1..200, default 80
 *   locale     = zh | en (default en)
 *
 * Body (POST):
 *   { item_id: number, on: boolean, collection_id?: number, note?: string }
 */
import { parseJsonRequestBody } from "@/lib/api/json-body";
import {
  parseV1SavedQueryRequest,
  v1SavedPostBodySchema,
} from "@/lib/api/saved-requests";
import {
  listSavedItemsRoutePayload,
  saveItemRoutePayload,
} from "@/lib/api/saved-routes";
import {
  runV1Route,
  v1Error,
  v1InvalidQueryResult,
  v1Json,
  v1ServerError,
} from "@/lib/api/v1-route";

export async function GET(req: Request) {
  return runV1Route(req, async (user) => {
    const parsed = v1InvalidQueryResult(parseV1SavedQueryRequest(req));
    if (!parsed.ok) return parsed.response;

    const q = parsed.data;

    try {
      return v1Json(await listSavedItemsRoutePayload(user, q));
    } catch (err) {
      return v1ServerError("api/v1/saved GET", err);
    }
  });
}

export async function POST(req: Request) {
  return runV1Route(req, async (user) => {
    const parsed = await parseJsonRequestBody(req, v1SavedPostBodySchema, {
      envelope: "plain",
    });
    if (!parsed.ok) return parsed.response;

    const b = parsed.data;

    try {
      const result = await saveItemRoutePayload(user, {
        itemId: b.item_id,
        on: b.on,
        collectionId: b.collection_id,
        note: b.note,
      });
      if (!result.ok) return v1Error(result.error, result.status);
      return v1Json(result.payload);
    } catch (err) {
      return v1ServerError("api/v1/saved POST", err);
    }
  });
}
