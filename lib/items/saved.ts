import { desc, eq, and, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources, feedback, clusters } from "@/db/schema";
import type { Story } from "@/lib/types";

/**
 * Fetch the current user's saved items (feedback.vote='save') joined with
 * their enriched content. Returns the same Story shape as getFeaturedStories
 * so the Item component renders identically.
 */
export async function getSavedStories(
  userId: string,
  locale: "zh" | "en",
  limit = 80,
): Promise<Array<Story & { savedAt: string }>> {
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
    })
    .from(feedback)
    .innerJoin(items, eq(feedback.itemId, items.id))
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .leftJoin(clusters, eq(items.clusterId, clusters.id))
    .where(and(eq(feedback.userId, userId), eq(feedback.vote, "save")))
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
    };
  });
}

/** Count saved items per implicit collection — simple derived groupings. */
export async function getSavedCollections(userId: string): Promise<
  Array<{
    id: string;
    label: string;
    cjk: string;
    count: number;
  }>
> {
  const [row] = await db()
    .select({
      total: sql<number>`count(*)::int`,
      week: sql<number>`count(*) filter (where ${feedback.createdAt} > now() - interval '7 days')::int`,
      month: sql<number>`count(*) filter (where ${feedback.createdAt} > now() - interval '30 days')::int`,
    })
    .from(feedback)
    .where(and(eq(feedback.userId, userId), eq(feedback.vote, "save")));

  return [
    { id: "all", label: "all saved", cjk: "全部收藏", count: row?.total ?? 0 },
    { id: "week", label: "this week", cjk: "本周", count: row?.week ?? 0 },
    { id: "month", label: "this month", cjk: "本月", count: row?.month ?? 0 },
  ];
}
