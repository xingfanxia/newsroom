/**
 * GET /api/v1/items/:id — full-detail item lookup.
 *
 * The "give me everything you have on this item" endpoint: both-locale
 * title/summary, editor note, full markdown analysis, LLM reasoning, HKR
 * breakdown with per-axis reasons, full body_md transcript (for YT) or
 * article body. Intended for agents that spotted a hit in /feed and want
 * the deep context before commenting.
 *
 * Returns 404 on unknown id. No cluster dedup here — if the caller knows
 * the id they get exactly that row.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { items, sources } from "@/db/schema";
import { requireApiToken } from "@/lib/auth/api-token";

const idSchema = z.coerce.number().int().positive();

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;

  const { id: idRaw } = await ctx.params;
  const parsed = idSchema.safeParse(idRaw);
  if (!parsed.success) {
    return Response.json({ error: "invalid_id" }, { status: 400 });
  }
  const id = parsed.data;

  try {
    const client = db();
    const [row] = await client
      .select({
        id: items.id,
        sourceId: items.sourceId,
        title: items.title,
        titleZh: items.titleZh,
        titleEn: items.titleEn,
        summaryZh: items.summaryZh,
        summaryEn: items.summaryEn,
        body: items.body,
        bodyMd: items.bodyMd,
        editorNoteZh: items.editorNoteZh,
        editorNoteEn: items.editorNoteEn,
        editorAnalysisZh: items.editorAnalysisZh,
        editorAnalysisEn: items.editorAnalysisEn,
        reasoning: items.reasoning,
        reasoningZh: items.reasoningZh,
        reasoningEn: items.reasoningEn,
        hkr: items.hkr,
        url: items.url,
        canonicalUrl: items.canonicalUrl,
        importance: items.importance,
        tier: items.tier,
        tags: items.tags,
        publishedAt: items.publishedAt,
        enrichedAt: items.enrichedAt,
        commentaryAt: items.commentaryAt,
        author: items.author,
        sourceNameEn: sources.nameEn,
        sourceNameZh: sources.nameZh,
        sourceKind: sources.kind,
        sourceGroup: sources.group,
        sourceLocale: sources.locale,
        sourceUrl: sources.url,
      })
      .from(items)
      .innerJoin(sources, eq(items.sourceId, sources.id))
      .where(eq(items.id, id))
      .limit(1);

    if (!row) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    const tagBag = (row.tags ?? {}) as {
      capabilities?: string[];
      entities?: string[];
      topics?: string[];
    };

    return Response.json({
      id: String(row.id),
      source: {
        id: row.sourceId,
        name_en: row.sourceNameEn,
        name_zh: row.sourceNameZh,
        kind: row.sourceKind,
        group: row.sourceGroup,
        locale: row.sourceLocale,
        url: row.sourceUrl,
      },
      title: {
        raw: row.title,
        zh: row.titleZh,
        en: row.titleEn,
      },
      summary: {
        zh: row.summaryZh,
        en: row.summaryEn,
      },
      editor_note: {
        zh: row.editorNoteZh,
        en: row.editorNoteEn,
      },
      editor_analysis: {
        zh: row.editorAnalysisZh,
        en: row.editorAnalysisEn,
      },
      reasoning: {
        legacy: row.reasoning,
        zh: row.reasoningZh,
        en: row.reasoningEn,
      },
      hkr: row.hkr,
      tags: {
        capabilities: tagBag.capabilities ?? [],
        entities: tagBag.entities ?? [],
        topics: tagBag.topics ?? [],
      },
      importance: row.importance,
      tier: row.tier,
      url: row.url,
      canonical_url: row.canonicalUrl,
      author: row.author,
      published_at: row.publishedAt.toISOString(),
      enriched_at: row.enrichedAt?.toISOString() ?? null,
      commentary_at: row.commentaryAt?.toISOString() ?? null,
      body_md: row.bodyMd,
      body_rss: row.body,
    });
  } catch (err) {
    console.error("[api/v1/items/:id] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
