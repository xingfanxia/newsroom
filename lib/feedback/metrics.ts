import { desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { FeedbackEntry } from "@/lib/types";

export type FeedbackCounts = {
  total: number;
  agreed: number;
  disagreed: number;
  saved: number;
};

/**
 * Aggregate vote counts across the feedback table. `agreed` = up votes,
 * `disagreed` = down votes, `saved` = save/bookmark slots, `total` = up+down
 * only (saved is a separate UX affordance that shouldn't drive the iteration
 * readiness panel).
 */
export async function getFeedbackCounts(): Promise<FeedbackCounts> {
  const rows = await db()
    .select({
      vote: schema.feedback.vote,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.feedback)
    .groupBy(schema.feedback.vote);

  const by = Object.fromEntries(rows.map((r) => [r.vote, r.n])) as Partial<
    Record<"up" | "down" | "save", number>
  >;
  const agreed = by.up ?? 0;
  const disagreed = by.down ?? 0;
  const saved = by.save ?? 0;
  return { agreed, disagreed, saved, total: agreed + disagreed };
}

/**
 * Recent up/down feedback, joined with item titles so the admin panel can
 * render a FeedbackEntry stream that matches the existing mock shape.
 *
 * `save` entries are excluded — they're bookmarks, not editorial signal.
 */
export async function getRecentFeedback(
  locale: "zh" | "en",
  limit = 20,
): Promise<FeedbackEntry[]> {
  const rows = await db()
    .select({
      id: schema.feedback.id,
      vote: schema.feedback.vote,
      note: schema.feedback.note,
      createdAt: schema.feedback.createdAt,
      titleZh: schema.items.titleZh,
      titleEn: schema.items.titleEn,
      rawTitle: schema.items.title,
    })
    .from(schema.feedback)
    .innerJoin(schema.items, eq(schema.items.id, schema.feedback.itemId))
    .where(inArray(schema.feedback.vote, ["up", "down"]))
    .orderBy(desc(schema.feedback.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const title =
      locale === "en"
        ? r.titleEn ?? r.titleZh ?? r.rawTitle
        : r.titleZh ?? r.titleEn ?? r.rawTitle;
    return {
      id: `fb${r.id}`,
      verdict: r.vote === "up" ? "up" : "down",
      title,
      note: r.note ?? "",
      createdAt: r.createdAt.toISOString(),
    };
  });
}
