import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { upsertAppUser, type SessionUser } from "@/lib/auth/session";
import {
  FEEDBACK_SIGNAL_VOTES,
  FEEDBACK_VOTES,
  type FeedbackSignalVote,
  type FeedbackVote,
} from "@/lib/types";

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
  vote: z.enum(FEEDBACK_VOTES),
  on: z.boolean(),
  note: z.string().max(500).optional(),
});

export type FeedbackBody = z.infer<typeof feedbackBodySchema>;

/** Per-user vote state returned after every toggle so the UI can reconcile. */
export type UserVotes = Record<FeedbackVote, boolean>;

const OPPOSING_FEEDBACK_SIGNAL_VOTE = {
  up: "down",
  down: "up",
} satisfies Record<FeedbackSignalVote, FeedbackSignalVote>;

function isFeedbackSignalVote(vote: FeedbackVote): vote is FeedbackSignalVote {
  return FEEDBACK_SIGNAL_VOTES.includes(vote as FeedbackSignalVote);
}

function emptyUserVotes(): UserVotes {
  return Object.fromEntries(
    FEEDBACK_VOTES.map((vote) => [vote, false]),
  ) as UserVotes;
}

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
      if (isFeedbackSignalVote(body.vote)) {
        const opposing = OPPOSING_FEEDBACK_SIGNAL_VOTE[body.vote];
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
  const state = emptyUserVotes();
  for (const r of rows) state[r.vote] = true;
  return state;
}
