import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { upsertAppUser, type SessionUser } from "@/lib/auth/session";

/**
 * Request body for POST /api/feedback.
 *
 * - `itemId` — numeric PK of the item being voted on.
 * - `vote`   — which slot: up, down, save.
 * - `on`     — true to set the vote, false to clear it (toggle off).
 * - `note`   — optional short free-text (used later for disagree rationales).
 */
export const feedbackBodySchema = z.object({
  itemId: z.number().int().positive(),
  vote: z.enum(["up", "down", "save"]),
  on: z.boolean(),
  note: z.string().max(500).optional(),
});

export type FeedbackBody = z.infer<typeof feedbackBodySchema>;

/** Per-user vote state returned after every toggle so the UI can reconcile. */
export type UserVotes = {
  up: boolean;
  down: boolean;
  save: boolean;
};

/**
 * Apply a toggle. Enforces up/down mutual exclusion: setting `up=on` clears
 * any existing `down` vote for the same (item, user) and vice versa. `save`
 * is independent.
 *
 * The upsert-by-conflict path is idempotent so a double-click never produces
 * two rows and never surfaces a DB error to the caller.
 */
export async function applyFeedbackToggle(
  user: SessionUser,
  body: FeedbackBody,
): Promise<UserVotes> {
  await upsertAppUser(user);

  await db().transaction(async (tx) => {
    if (body.on) {
      if (body.vote === "up" || body.vote === "down") {
        const opposing = body.vote === "up" ? "down" : "up";
        await tx
          .delete(schema.feedback)
          .where(
            and(
              eq(schema.feedback.itemId, body.itemId),
              eq(schema.feedback.userId, user.id),
              eq(schema.feedback.vote, opposing),
            ),
          );
      }
      await tx
        .insert(schema.feedback)
        .values({
          itemId: body.itemId,
          userId: user.id,
          vote: body.vote,
          note: body.note ?? null,
        })
        .onConflictDoNothing({
          target: [
            schema.feedback.itemId,
            schema.feedback.userId,
            schema.feedback.vote,
          ],
        });
    } else {
      await tx
        .delete(schema.feedback)
        .where(
          and(
            eq(schema.feedback.itemId, body.itemId),
            eq(schema.feedback.userId, user.id),
            eq(schema.feedback.vote, body.vote),
          ),
        );
    }
  });

  return currentVotes(user.id, body.itemId);
}

/** Read the user's current vote state for a single item. */
export async function currentVotes(
  userId: string,
  itemId: number,
): Promise<UserVotes> {
  const rows = await db()
    .select({ vote: schema.feedback.vote })
    .from(schema.feedback)
    .where(
      and(
        eq(schema.feedback.userId, userId),
        eq(schema.feedback.itemId, itemId),
      ),
    );
  const state: UserVotes = { up: false, down: false, save: false };
  for (const r of rows) state[r.vote] = true;
  return state;
}
