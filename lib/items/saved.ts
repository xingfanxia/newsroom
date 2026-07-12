import { desc, eq, and, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources, feedback, clusters } from "@/db/schema";
import {
  eventStorySelectFields,
  storySelectFields,
} from "@/lib/items/story-select";
import { toStory } from "@/lib/items/story-mapper";
import { FEEDBACK_SAVE_VOTE, type AppLocale, type Story } from "@/lib/types";

/**
 * Fetch the current user's saved items (feedback.vote='save') joined with
 * their enriched content. Returns the same Story shape as getFeaturedStories
 * plus savedAt + collectionId so the meta-strip can render the origin.
 *
 * `collection`: positive integer → only that collection, "inbox" → only
 *   uncategorized (collection_id IS NULL), undefined → all saves.
 */
export async function getSavedStories(
  userId: string,
  locale: AppLocale,
  opts: { limit?: number; collection?: number | "inbox" | null } = {},
): Promise<Array<Story & { savedAt: string; collectionId: number | null }>> {
  const limit = opts.limit ?? 80;
  const collectionFilter =
    opts.collection === "inbox"
      ? isNull(feedback.collectionId)
      : typeof opts.collection === "number"
        ? eq(feedback.collectionId, opts.collection)
        : undefined;
  const rows = await db()
    .select({
      ...storySelectFields,
      ...eventStorySelectFields,
      savedAt: feedback.createdAt,
      collectionId: feedback.collectionId,
    })
    .from(feedback)
    .innerJoin(items, eq(feedback.itemId, items.id))
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .leftJoin(clusters, eq(items.clusterId, clusters.id))
    .where(
      and(
        eq(feedback.userId, userId),
        eq(feedback.vote, FEEDBACK_SAVE_VOTE),
        ...(collectionFilter ? [collectionFilter] : []),
      ),
    )
    .orderBy(desc(feedback.createdAt))
    .limit(limit);

  return rows.map((r) => {
    return {
      ...toStory(r, {
        locale,
        tagLimit: 6,
        includeSourceGroup: true,
      }),
      savedAt: r.savedAt.toISOString(),
      collectionId: r.collectionId,
    };
  });
}

/** Aggregate save counts for the sidebar hero: total + this-week + this-month. */
export async function getSavedTotals(userId: string): Promise<{
  total: number;
  thisWeek: number;
  thisMonth: number;
}> {
  const [row] = await db()
    .select({
      total: sql<number>`count(*)`,
      week: sql<number>`count(*) filter (where ${feedback.createdAt} > ${Date.now() - 7 * 86_400_000})`,
      month: sql<number>`count(*) filter (where ${feedback.createdAt} > ${Date.now() - 30 * 86_400_000})`,
    })
    .from(feedback)
    .where(
      and(eq(feedback.userId, userId), eq(feedback.vote, FEEDBACK_SAVE_VOTE)),
    );
  return {
    total: row?.total ?? 0,
    thisWeek: row?.week ?? 0,
    thisMonth: row?.month ?? 0,
  };
}

/** Top N tags across a user's current saved set — drives the tags section. */
export async function getSavedTags(
  userId: string,
  opts: { collection?: number | "inbox" | null; limit?: number } = {},
): Promise<Array<{ tag: string; count: number }>> {
  const limit = opts.limit ?? 12;
  const collectionCond =
    opts.collection === "inbox"
      ? sql`AND ${feedback.collectionId} IS NULL`
      : typeof opts.collection === "number"
        ? sql`AND ${feedback.collectionId} = ${opts.collection}`
        : sql``;

  // items.tags is JSON text with three array keys; SQLite has no jsonb `||`
  // concat, so unnest each key as a UNION ALL branch of json_each.
  const rows = await db().all<{ tag: string; n: number }>(sql`
    WITH tag_values AS (
      SELECT je.value AS tag
      FROM ${feedback}
      INNER JOIN ${items} ON ${items.id} = ${feedback.itemId},
        json_each(coalesce(json_extract(${items.tags}, '$.capabilities'), '[]')) je
      WHERE ${feedback.userId} = ${userId}
        AND ${feedback.vote} = ${FEEDBACK_SAVE_VOTE}
        ${collectionCond}
      UNION ALL
      SELECT je.value AS tag
      FROM ${feedback}
      INNER JOIN ${items} ON ${items.id} = ${feedback.itemId},
        json_each(coalesce(json_extract(${items.tags}, '$.entities'), '[]')) je
      WHERE ${feedback.userId} = ${userId}
        AND ${feedback.vote} = ${FEEDBACK_SAVE_VOTE}
        ${collectionCond}
      UNION ALL
      SELECT je.value AS tag
      FROM ${feedback}
      INNER JOIN ${items} ON ${items.id} = ${feedback.itemId},
        json_each(coalesce(json_extract(${items.tags}, '$.topics'), '[]')) je
      WHERE ${feedback.userId} = ${userId}
        AND ${feedback.vote} = ${FEEDBACK_SAVE_VOTE}
        ${collectionCond}
    )
    SELECT tag, count(*) AS n
    FROM tag_values
    GROUP BY tag
    ORDER BY n DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({ tag: String(r.tag), count: Number(r.n) }));
}
