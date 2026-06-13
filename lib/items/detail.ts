import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources } from "@/db/schema";
import { toStory } from "@/lib/items/story-mapper";
import type { AppLocale, Story } from "@/lib/types";

type Locale = AppLocale;

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
      sourceId: items.sourceId,
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

  const story: Story = toStory(r, {
    locale,
    tagLimit: 6,
    includeSourceGroup: true,
  });

  return {
    story,
    bodyMd: r.bodyMd ?? null,
    bodyFetchedAt: r.bodyFetchedAt ? r.bodyFetchedAt.toISOString() : null,
  };
}
