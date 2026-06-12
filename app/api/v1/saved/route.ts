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
import { requireApiToken } from "@/lib/auth/api-token";
import { applyFeedbackToggle } from "@/lib/feedback/toggle";
import { toSavedAgentApiItem } from "@/lib/api/v1-items";
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
  locale: z.enum(["zh", "en"]).optional().default("en"),
});

const postBodySchema = z.object({
  item_id: z.number().int().positive(),
  on: z.boolean(),
  collection_id: z.number().int().positive().optional(),
  note: z.string().max(500).optional(),
});

export async function GET(req: Request) {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;
  const { user } = auth;

  const url = new URL(req.url);
  const parsed = getQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_query", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const q = parsed.data;

  try {
    const stories = await getSavedStories(user.id, q.locale, {
      limit: q.limit,
      collection: q.collection ?? null,
    });
    return Response.json({
      items: stories.map((s) => toSavedAgentApiItem(s, q.locale)),
      total: stories.length,
    });
  } catch (err) {
    console.error("[api/v1/saved GET] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;
  const { user } = auth;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = postBodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const b = parsed.data;

  try {
    if (
      b.on &&
      b.collection_id !== undefined &&
      !(await userOwnsSavedCollection(user.id, b.collection_id))
    ) {
      return Response.json({ error: "collection_not_found" }, { status: 404 });
    }

    const votes = await applyFeedbackToggle(user, {
      itemId: b.item_id,
      vote: "save",
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
        return Response.json({ error: assigned.reason }, { status: 404 });
      }
      collectionId = assigned.collectionId;
    } else if (votes.save) {
      collectionId = await getSavedItemCollectionId(user.id, b.item_id);
    }

    return Response.json({
      item_id: b.item_id,
      saved: votes.save,
      collection_id: collectionId,
    });
  } catch (err) {
    // FK-violation on item_id → 404 rather than 500 (caller gave a bad id).
    const msg = err instanceof Error ? err.message : String(err);
    if (/foreign key|not present/i.test(msg)) {
      return Response.json({ error: "item_not_found" }, { status: 404 });
    }
    console.error("[api/v1/saved POST] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
