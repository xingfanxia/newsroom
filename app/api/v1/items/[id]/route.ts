/**
 * GET /api/v1/items/:id — full-detail item lookup.
 *
 * The "give me everything you have on this item" endpoint: both-locale
 * title/summary, editor note, full markdown analysis, LLM reasoning, HKR
 * breakdown with per-axis reasons, full body_md transcript (for YT) or
 * article body. Intended for agents that spotted a hit in /feed and want
 * the deep context before commenting.
 *
 * If the item belongs to a multi-member event cluster, the response
 * includes an `event` block with the cluster-level canonical title,
 * cross-source commentary, importance, tier, and a members_url to fetch
 * the full coverage list. For singletons, `event` is null.
 *
 * Returns 404 on unknown id. No cluster dedup here — if the caller knows
 * the id they get exactly that row.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { items, sources, clusters } from "@/db/schema";
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
        clusterId: items.clusterId,
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
        // Event-level fields — populated when item is in a multi-member cluster.
        clusterMemberCount: clusters.memberCount,
        clusterCanonicalTitleZh: clusters.canonicalTitleZh,
        clusterCanonicalTitleEn: clusters.canonicalTitleEn,
        clusterEditorNoteZh: clusters.editorNoteZh,
        clusterEditorNoteEn: clusters.editorNoteEn,
        clusterEditorAnalysisZh: clusters.editorAnalysisZh,
        clusterEditorAnalysisEn: clusters.editorAnalysisEn,
        clusterFirstSeenAt: clusters.firstSeenAt,
        clusterLatestMemberAt: clusters.latestMemberAt,
        clusterCommentaryAt: clusters.commentaryAt,
        clusterEventTier: clusters.eventTier,
        clusterImportance: clusters.importance,
        clusterVerifiedAt: clusters.verifiedAt,
      })
      .from(items)
      .innerJoin(sources, eq(items.sourceId, sources.id))
      .leftJoin(clusters, eq(clusters.id, items.clusterId))
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

    // If item belongs to a multi-member cluster, surface event-level info.
    // For singletons (member_count <= 1 or no cluster), event is null.
    const isEvent = row.clusterId != null && (row.clusterMemberCount ?? 0) > 1;
    const event = isEvent
      ? {
          cluster_id: row.clusterId,
          coverage: row.clusterMemberCount,
          tier: row.clusterEventTier,
          importance: row.clusterImportance,
          verified_at: row.clusterVerifiedAt?.toISOString() ?? null,
          first_seen_at: row.clusterFirstSeenAt?.toISOString() ?? null,
          latest_member_at: row.clusterLatestMemberAt?.toISOString() ?? null,
          canonical_title: {
            zh: row.clusterCanonicalTitleZh,
            en: row.clusterCanonicalTitleEn,
          },
          editor_note: {
            zh: row.clusterEditorNoteZh,
            en: row.clusterEditorNoteEn,
          },
          editor_analysis: {
            zh: row.clusterEditorAnalysisZh,
            en: row.clusterEditorAnalysisEn,
          },
          commentary_at: row.clusterCommentaryAt?.toISOString() ?? null,
          /** GET this for the cross-source list. */
          members_url: `/api/v1/events/${row.clusterId}/members`,
        }
      : null;

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
      event,
    });
  } catch (err) {
    console.error("[api/v1/items/:id] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
