import { and, desc, eq, sql, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources, clusters } from "@/db/schema";
import type { Story } from "@/lib/types";

type Tier = "featured" | "all" | "p1";
type Locale = "zh" | "en";

export type FeedQuery = {
  tier?: Tier;
  locale?: Locale;
  limit?: number;
};

/**
 * Fetch the curated feed for the home page timeline.
 * Returns Story[] in the shape the existing UI expects.
 * Only one item per cluster (the lead), with memberCount surfaced as crossSourceCount.
 */
export async function getFeaturedStories(q: FeedQuery = {}): Promise<Story[]> {
  const tier: Tier = q.tier ?? "featured";
  const limit = q.limit ?? 40;
  const client = db();

  // Tiers are inclusive: "featured" shows featured+p1; "all" shows everything non-excluded.
  const tierFilter =
    tier === "p1"
      ? sql`${items.tier} = 'p1'`
      : tier === "featured"
        ? sql`${items.tier} IN ('featured', 'p1')`
        : sql`${items.tier} <> 'excluded'`;

  // Cluster dedup: only return the item that's its cluster's lead.
  // Unclustered-but-enriched items are surfaced as-is (no cluster yet).
  const dedupFilter = sql`(${items.clusterId} IS NULL OR ${clusters.leadItemId} = ${items.id})`;

  const rows = await client
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
      reasoning: items.reasoning,
      reasoningZh: items.reasoningZh,
      reasoningEn: items.reasoningEn,
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
      clusterMemberCount: clusters.memberCount,
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .leftJoin(clusters, eq(items.clusterId, clusters.id))
    .where(
      and(
        isNotNull(items.enrichedAt),
        isNotNull(items.importance),
        tierFilter,
        dedupFilter,
      ),
    )
    .orderBy(desc(items.publishedAt))
    .limit(limit);

  return rows.map((r): Story => {
    const tagBag = (r.tags ?? {}) as {
      capabilities?: string[];
      entities?: string[];
      topics?: string[];
    };
    // Flatten for UI. Canonical English IDs stored in DB; UI localizes at render.
    const flatTags = [
      ...(tagBag.capabilities ?? []),
      ...(tagBag.entities ?? []),
      ...(tagBag.topics ?? []),
    ].slice(0, 4);

    const publisher =
      q.locale === "en" ? r.sourceNameEn : r.sourceNameZh;

    // Title fallback ladder: prefer LLM-translated locale match, fall back to
    // the other locale, fall back to the raw source title.
    const title =
      q.locale === "en"
        ? r.titleEn ?? r.titleZh ?? r.title
        : r.titleZh ?? r.titleEn ?? r.title;

    const editorNote =
      q.locale === "en"
        ? r.editorNoteEn ?? r.editorNoteZh
        : r.editorNoteZh ?? r.editorNoteEn;
    const editorAnalysis =
      q.locale === "en"
        ? r.editorAnalysisEn ?? r.editorAnalysisZh
        : r.editorAnalysisZh ?? r.editorAnalysisEn;

    return {
      id: String(r.id),
      source: {
        publisher,
        kindCode: r.sourceKind as Story["source"]["kindCode"],
        localeCode: (r.sourceLocale ?? "multi") as Story["source"]["localeCode"],
      },
      featured: r.tier === "featured" || r.tier === "p1",
      title,
      summary:
        q.locale === "en"
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
        q.locale === "en"
          ? r.reasoningEn ?? r.reasoningZh ?? r.reasoning ?? undefined
          : r.reasoningZh ?? r.reasoningEn ?? r.reasoning ?? undefined,
      hkr: (r.hkr as Story["hkr"]) ?? undefined,
    };
  });
}

