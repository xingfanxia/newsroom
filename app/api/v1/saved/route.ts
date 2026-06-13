/**
 * GET  /api/v1/saved  — list the caller's saved items.
 * POST /api/v1/saved  — toggle the save slot for an item on/off.
 *
 * Both operations are thin wrappers around the same helpers the browser
 * UI uses (getSavedStories, applyFeedbackToggle) so the agent-facing and
 * human-facing surfaces can never drift.
 *
 * Query params (GET):
 *   collection = <id> | inbox (omitted = all)
 *   limit      = 1..200, default 80
 *   locale     = zh | en (default en)
 *
 * Body (POST):
 *   { item_id: number, on: boolean, collection_id?: number, note?: string }
 */
import { z } from "zod";
import { parseJsonRequestBody } from "@/lib/api/json-body";
import { parseQueryParams } from "@/lib/api/query-params";
import {
  runV1Route,
  v1Error,
  v1InvalidQuery,
  v1Json,
  v1ServerError,
} from "@/lib/api/v1-route";
import { applyFeedbackToggle } from "@/lib/feedback/toggle";
import { toSavedAgentApiItem } from "@/lib/api/v1-items";
import { APP_LOCALES, FEEDBACK_SAVE_VOTE } from "@/lib/types";
import {
  assignSavedItemCollection,
  getSavedItemCollectionId,
  userOwnsSavedCollection,
} from "@/lib/items/collections";
import { getSavedStories } from "@/lib/items/saved";

const getQuerySchema = z.object({
  collection: z
    .union([z.literal("inbox"), z.coerce.number().int().positive()])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(80),
  locale: z.enum(APP_LOCALES).optional().default("en"),
});

const postBodySchema = z.object({
  item_id: z.number().int().positive(),
  on: z.boolean(),
  collection_id: z.number().int().positive().optional(),
  note: z.string().max(500).optional(),
});

export async function GET(req: Request) {
  return runV1Route(req, async (user) => {
    const parsed = parseQueryParams(req, getQuerySchema);
    if (!parsed.ok) return v1InvalidQuery(parsed.issues);

    const q = parsed.data;

    try {
      const stories = await getSavedStories(user.id, q.locale, {
        limit: q.limit,
        collection: q.collection ?? null,
      });
      return v1Json({
        items: stories.map((s) => toSavedAgentApiItem(s, q.locale)),
        total: stories.length,
      });
    } catch (err) {
      return v1ServerError("api/v1/saved GET", err);
    }
  });
}

export async function POST(req: Request) {
  return runV1Route(req, async (user) => {
    const parsed = await parseJsonRequestBody(req, postBodySchema, {
      envelope: "plain",
    });
    if (!parsed.ok) return parsed.response;

    const b = parsed.data;

    try {
      if (
        b.on &&
        b.collection_id !== undefined &&
        !(await userOwnsSavedCollection(user.id, b.collection_id))
      ) {
        return v1Error("collection_not_found", 404);
      }

      const votes = await applyFeedbackToggle(user, {
        itemId: b.item_id,
        vote: FEEDBACK_SAVE_VOTE,
        on: b.on,
        note: b.note,
      });

      let collectionId: number | null = null;
      if (votes.save && b.collection_id !== undefined) {
        const assigned = await assignSavedItemCollection({
          userId: user.id,
          itemId: b.item_id,
          targetCollectionId: b.collection_id,
        });
        if (!assigned.ok) {
          return v1Error(assigned.reason, 404);
        }
        collectionId = assigned.collectionId;
      } else if (votes.save) {
        collectionId = await getSavedItemCollectionId(user.id, b.item_id);
      }

      return v1Json({
        item_id: b.item_id,
        saved: votes.save,
        collection_id: collectionId,
      });
    } catch (err) {
      // FK-violation on item_id → 404 rather than 500 (caller gave a bad id).
      const msg = err instanceof Error ? err.message : String(err);
      if (/foreign key|not present/i.test(msg)) {
        return v1Error("item_not_found", 404);
      }
      return v1ServerError("api/v1/saved POST", err);
    }
  });
}
