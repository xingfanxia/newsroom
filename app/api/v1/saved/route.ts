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
import { getSavedStories } from "@/lib/items/saved";
import { db } from "@/db/client";
import { feedback } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

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
      items: stories.map((s) => ({
        id: s.id,
        title: s.title,
        summary: s.summary,
        publisher: s.source.publisher,
        source_id: s.sourceId,
        source_group: s.source.groupCode ?? null,
        source_kind: s.source.kindCode,
        tier: s.tier,
        importance: s.importance,
        hkr: s.hkr ?? null,
        tags: s.tags,
        url: s.url,
        published_at: s.publishedAt,
        saved_at: s.savedAt,
        collection_id: s.collectionId,
      })),
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
    const votes = await applyFeedbackToggle(user, {
      itemId: b.item_id,
      vote: "save",
      on: b.on,
      note: b.note,
    });

    // When saving on, optionally pin to a specific collection. Existing
    // feedback-toggle only sets the vote row; collection assignment is a
    // follow-up UPDATE because the toggle API stays single-purpose.
    if (b.on && b.collection_id !== undefined) {
      await db()
        .update(feedback)
        .set({ collectionId: b.collection_id })
        .where(
          and(
            eq(feedback.itemId, b.item_id),
            eq(feedback.userId, user.id),
            eq(feedback.vote, "save"),
          ),
        );
    }

    // Return authoritative state — the agent can trust this to reconcile.
    const [row] = await db()
      .select({ collectionId: feedback.collectionId })
      .from(feedback)
      .where(
        and(
          eq(feedback.itemId, b.item_id),
          eq(feedback.userId, user.id),
          eq(feedback.vote, "save"),
        ),
      )
      .limit(1);

    return Response.json({
      item_id: b.item_id,
      saved: votes.save,
      collection_id: row?.collectionId ?? null,
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

// Keep postgres happy about the unused sql import for when we add
// collection-pin race semantics (v2).
void sql;
