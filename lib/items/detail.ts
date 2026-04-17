import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources } from "@/db/schema";
import type { Story } from "@/lib/types";

type Locale = "zh" | "en";

/**
 * Full detail for a single item — same locale-resolved surface as the list
 * queries, but additionally returns `bodyMd` (raw article / transcript text)
 * for rendering on the podcast detail page.
 *
 * Returns null when the item doesn't exist, isn't enriched, or is explicitly
 * excluded (tier='excluded'). Callers should surface a 404 in that case.
 */
export type ItemDetail = {
  story: Story;
  /** Markdown body — Jina Reader output for articles, cleaned transcript for YT. */
  bodyMd: string | null;
  bodyFetchedAt: string | null;
};

export async function getItemDetail(
  id: number,
  locale: Locale,
): Promise<ItemDetail | null> {
  if (!Number.isInteger(id) || id <= 0) return null;

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
      reasoning: items.reasoning,
      reasoningZh: items.reasoningZh,
      reasoningEn: items.reasoningEn,
      hkr: items.hkr,
      url: items.url,
      importance: items.importance,
      tier: items.tier,
      tags: items.tags,
      publishedAt: items.publishedAt,
      bodyMd: items.bodyMd,
      bodyFetchedAt: items.bodyFetchedAt,
      sourceNameZh: sources.nameZh,
      sourceNameEn: sources.nameEn,
      sourceLocale: sources.locale,
      sourceKind: sources.kind,
      sourceGroup: sources.group,
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(and(eq(items.id, id), isNotNull(items.enrichedAt)))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  if (r.tier === "excluded") return null;

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

  const title =
    locale === "en"
      ? r.titleEn ?? r.titleZh ?? r.title
      : r.titleZh ?? r.titleEn ?? r.title;
  const editorNote =
    locale === "en"
      ? r.editorNoteEn ?? r.editorNoteZh
      : r.editorNoteZh ?? r.editorNoteEn;
  const editorAnalysis =
    locale === "en"
      ? r.editorAnalysisEn ?? r.editorAnalysisZh
      : r.editorAnalysisZh ?? r.editorAnalysisEn;

  const story: Story = {
    id: String(r.id),
    source: {
      publisher: locale === "en" ? r.sourceNameEn : r.sourceNameZh,
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
    locale: (r.sourceLocale ?? "multi") as Story["locale"],
    editorNote: editorNote ?? undefined,
    editorAnalysis: editorAnalysis ?? undefined,
    reasoning:
      locale === "en"
        ? r.reasoningEn ?? r.reasoningZh ?? r.reasoning ?? undefined
        : r.reasoningZh ?? r.reasoningEn ?? r.reasoning ?? undefined,
    hkr: (r.hkr as Story["hkr"]) ?? undefined,
  };

  return {
    story,
    bodyMd: r.bodyMd ?? null,
    bodyFetchedAt: r.bodyFetchedAt ? r.bodyFetchedAt.toISOString() : null,
  };
}
