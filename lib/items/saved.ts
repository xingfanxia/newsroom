import { desc, eq, and, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources, feedback, clusters } from "@/db/schema";
import type { Story } from "@/lib/types";

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
  locale: "zh" | "en",
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
      id: items.id,
      title: items.title,
      titleZh: items.titleZh,
      titleEn: items.titleEn,
      summaryZh: items.summaryZh,
      summaryEn: items.summaryEn,
      editorNoteZh: items.editorNoteZh,
      editorNoteEn: items.editorNoteEn,
      editorAnalysisZh: items.editorAnalysisZh,
      editorAnalysisEn: items.editorAnalysisEn,
      reasoningZh: items.reasoningZh,
      reasoningEn: items.reasoningEn,
      reasoning: items.reasoning,
      hkr: items.hkr,
      url: items.url,
      importance: items.importance,
      tier: items.tier,
      tags: items.tags,
      publishedAt: items.publishedAt,
      sourceId: items.sourceId,
      sourceNameZh: sources.nameZh,
      sourceNameEn: sources.nameEn,
      sourceLocale: sources.locale,
      sourceKind: sources.kind,
      sourceGroup: sources.group,
      clusterMemberCount: clusters.memberCount,
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
        eq(feedback.vote, "save"),
        ...(collectionFilter ? [collectionFilter] : []),
      ),
    )
    .orderBy(desc(feedback.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const tagBag = (r.tags ?? {}) as {
      capabilities?: string[];
      entities?: string[];
      topics?: string[];
    };
    const flatTags = [
      ...(tagBag.capabilities ?? []),
      ...(tagBag.entities ?? []),
      ...(tagBag.topics ?? []),
    ].slice(0, 6);

    const publisher =
      locale === "en" ? r.sourceNameEn : r.sourceNameZh;
    const title =
      locale === "en"
        ? r.titleEn ?? r.titleZh ?? r.title
        : r.titleZh ?? r.titleEn ?? r.title;
    const editorNote =
      locale === "en" ? r.editorNoteEn ?? r.editorNoteZh : r.editorNoteZh ?? r.editorNoteEn;
    const editorAnalysis =
      locale === "en"
        ? r.editorAnalysisEn ?? r.editorAnalysisZh
        : r.editorAnalysisZh ?? r.editorAnalysisEn;

    return {
      id: String(r.id),
      source: {
        publisher,
        kindCode: r.sourceKind as Story["source"]["kindCode"],
        localeCode: (r.sourceLocale ?? "multi") as Story["source"]["localeCode"],
        groupCode: r.sourceGroup as Story["source"]["groupCode"],
      },
      featured: r.tier === "featured" || r.tier === "p1",
      title,
      summary:
        locale === "en"
          ? r.summaryEn ?? r.summaryZh ?? ""
          : r.summaryZh ?? r.summaryEn ?? "",
      tags: flatTags,
      importance: r.importance ?? 0,
      tier: (r.tier ?? "all") as Story["tier"],
      publishedAt: r.publishedAt.toISOString(),
      url: r.url,
      crossSourceCount:
        r.clusterMemberCount && r.clusterMemberCount > 1
          ? r.clusterMemberCount - 1
          : undefined,
      locale: (r.sourceLocale ?? "multi") as Story["locale"],
      editorNote: editorNote ?? undefined,
      editorAnalysis: editorAnalysis ?? undefined,
      reasoning:
        locale === "en"
          ? r.reasoningEn ?? r.reasoningZh ?? r.reasoning ?? undefined
          : r.reasoningZh ?? r.reasoningEn ?? r.reasoning ?? undefined,
      hkr: (r.hkr as Story["hkr"]) ?? undefined,
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
      total: sql<number>`count(*)::int`,
      week: sql<number>`count(*) filter (where ${feedback.createdAt} > now() - interval '7 days')::int`,
      month: sql<number>`count(*) filter (where ${feedback.createdAt} > now() - interval '30 days')::int`,
    })
    .from(feedback)
    .where(and(eq(feedback.userId, userId), eq(feedback.vote, "save")));
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

  const rows = await db().execute(sql`
    SELECT t AS tag, count(*)::int AS n
    FROM ${feedback}
    INNER JOIN ${items} ON ${items.id} = ${feedback.itemId},
      LATERAL jsonb_array_elements_text(
        coalesce(${items.tags}->'capabilities', '[]'::jsonb)
        || coalesce(${items.tags}->'entities',     '[]'::jsonb)
        || coalesce(${items.tags}->'topics',       '[]'::jsonb)
      ) AS t
    WHERE ${feedback.userId} = ${userId}
      AND ${feedback.vote} = 'save'
      ${collectionCond}
    GROUP BY t
    ORDER BY n DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({ tag: String(r.tag), count: Number(r.n) }));
}
