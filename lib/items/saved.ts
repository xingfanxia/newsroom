import { desc, eq, and, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources, feedback, clusters } from "@/db/schema";
import { pickLocalizedText, pickSameLocaleText } from "@/lib/items/localized";
import { flattenItemTags } from "@/lib/items/tags";
import {
  FEEDBACK_SAVE_VOTE,
  isHighlightItemTier,
  type Story,
} from "@/lib/types";

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
      clusterId: items.clusterId,
      clusterMemberCount: clusters.memberCount,
      clusterCoverage: clusters.coverage,
      clusterFirstSeenAt: clusters.firstSeenAt,
      clusterLatestMemberAt: clusters.latestMemberAt,
      clusterCanonicalTitleZh: clusters.canonicalTitleZh,
      clusterCanonicalTitleEn: clusters.canonicalTitleEn,
      clusterEditorNoteZh: clusters.editorNoteZh,
      clusterEditorNoteEn: clusters.editorNoteEn,
      clusterEditorAnalysisZh: clusters.editorAnalysisZh,
      clusterEditorAnalysisEn: clusters.editorAnalysisEn,
      clusterImportance: clusters.importance,
      clusterEventTier: clusters.eventTier,
      clusterHkr: clusters.hkr,
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
    const flatTags = flattenItemTags(r.tags, 6);

    const publisher =
      pickSameLocaleText(locale, {
        en: r.sourceNameEn,
        zh: r.sourceNameZh,
      }) ?? r.sourceId;
    const title =
      pickSameLocaleText(locale, {
        en: r.clusterCanonicalTitleEn,
        zh: r.clusterCanonicalTitleZh,
      }) ??
      pickLocalizedText(locale, {
        en: r.titleEn,
        zh: r.titleZh,
        fallback: r.title,
      })!;
    const editorNote =
      pickLocalizedText(locale, {
        en: r.clusterEditorNoteEn,
        zh: r.clusterEditorNoteZh,
      }) ??
      pickLocalizedText(locale, {
        en: r.editorNoteEn,
        zh: r.editorNoteZh,
      });
    const editorAnalysis =
      pickLocalizedText(locale, {
        en: r.clusterEditorAnalysisEn,
        zh: r.clusterEditorAnalysisZh,
      }) ??
      pickLocalizedText(locale, {
        en: r.editorAnalysisEn,
        zh: r.editorAnalysisZh,
      });
    const effectiveImportance = r.clusterImportance ?? r.importance ?? 0;
    const effectiveTier = (r.clusterEventTier ?? r.tier ?? "all") as Story["tier"];
    const effectiveHkr =
      (r.clusterHkr as Story["hkr"] | null) ?? (r.hkr as Story["hkr"] | null);
    const coverage =
      r.clusterMemberCount && r.clusterMemberCount > 1
        ? r.clusterMemberCount
        : undefined;

    return {
      id: String(r.id),
      sourceId: r.sourceId,
      source: {
        publisher,
        kindCode: r.sourceKind as Story["source"]["kindCode"],
        localeCode: (r.sourceLocale ?? "multi") as Story["source"]["localeCode"],
        groupCode: r.sourceGroup as Story["source"]["groupCode"],
      },
      featured: isHighlightItemTier(effectiveTier),
      title,
      summary: pickLocalizedText(locale, {
        en: r.summaryEn,
        zh: r.summaryZh,
      }) ?? "",
      tags: flatTags,
      importance: effectiveImportance,
      tier: effectiveTier,
      publishedAt: r.publishedAt.toISOString(),
      url: r.url,
      crossSourceCount:
        r.clusterMemberCount && r.clusterMemberCount > 1
          ? r.clusterMemberCount - 1
          : undefined,
      locale: (r.sourceLocale ?? "multi") as Story["locale"],
      editorNote: editorNote ?? undefined,
      editorAnalysis: editorAnalysis ?? undefined,
      reasoning: pickLocalizedText(locale, {
        en: r.reasoningEn,
        zh: r.reasoningZh,
        fallback: r.reasoning,
      }) ?? undefined,
      hkr: effectiveHkr ?? undefined,
      clusterId: r.clusterId ?? undefined,
      coverage,
      firstSeenAt: r.clusterFirstSeenAt?.toISOString(),
      latestMemberAt: r.clusterLatestMemberAt?.toISOString(),
      canonicalTitleZh: r.clusterCanonicalTitleZh ?? undefined,
      canonicalTitleEn: r.clusterCanonicalTitleEn ?? undefined,
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
      AND ${feedback.vote} = ${FEEDBACK_SAVE_VOTE}
      ${collectionCond}
    GROUP BY t
    ORDER BY n DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({ tag: String(r.tag), count: Number(r.n) }));
}
