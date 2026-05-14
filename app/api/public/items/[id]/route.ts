/**
 * GET /api/public/items/:id — Anonymous full-item detail.
 *
 * Mirrors /api/v1/items/:id but strips LLM internals:
 *   - omits raw `reasoning` / `reasoningZh` / `reasoningEn`
 *   - keeps editor_note + editor_analysis (those ARE the public take)
 *   - HKR booleans only (no per-axis reasonsZh/reasonsEn)
 *   - body_md kept (transcript / article text); body_rss (raw HTML) dropped
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { items, sources, clusters } from "@/db/schema";
import { publicRateLimit } from "@/lib/rate-limit/public";
import {
  computeEtag,
  etagSignal,
  ifNoneMatch,
  notModified,
  publicError,
  publicJson,
} from "@/lib/api/public-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idSchema = z.coerce.number().int().positive();

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const limited = publicRateLimit(req, {
    family: "public-items",
    windowMs: 60_000,
    max: 600,
  });
  if (limited) return limited;

  const { id: idRaw } = await ctx.params;
  const parsed = idSchema.safeParse(idRaw);
  if (!parsed.success) return publicError("invalid_id", 400);
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
        bodyMd: items.bodyMd,
        editorNoteZh: items.editorNoteZh,
        editorNoteEn: items.editorNoteEn,
        editorAnalysisZh: items.editorAnalysisZh,
        editorAnalysisEn: items.editorAnalysisEn,
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
        clusterMemberCount: clusters.memberCount,
        clusterCanonicalTitleZh: clusters.canonicalTitleZh,
        clusterCanonicalTitleEn: clusters.canonicalTitleEn,
        clusterEditorNoteZh: clusters.editorNoteZh,
        clusterEditorNoteEn: clusters.editorNoteEn,
        clusterEditorAnalysisZh: clusters.editorAnalysisZh,
        clusterEditorAnalysisEn: clusters.editorAnalysisEn,
        clusterFirstSeenAt: clusters.firstSeenAt,
        clusterLatestMemberAt: clusters.latestMemberAt,
        clusterEventTier: clusters.eventTier,
        clusterImportance: clusters.importance,
      })
      .from(items)
      .innerJoin(sources, eq(items.sourceId, sources.id))
      .leftJoin(clusters, eq(clusters.id, items.clusterId))
      .where(eq(items.id, id))
      .limit(1);

    if (!row) return publicError("not_found", 404);

    const tagBag = (row.tags ?? {}) as {
      capabilities?: string[];
      entities?: string[];
      topics?: string[];
    };

    const isEvent = row.clusterId != null && (row.clusterMemberCount ?? 0) > 1;
    const event = isEvent
      ? {
          cluster_id: row.clusterId,
          coverage: row.clusterMemberCount,
          tier: row.clusterEventTier,
          importance: row.clusterImportance,
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
          members_url: `/api/public/events/${row.clusterId}/members`,
        }
      : null;

    // Strip per-axis HKR reasons; keep booleans.
    const hkrPublic = row.hkr
      ? (() => {
          const h = row.hkr as {
            h?: boolean;
            k?: boolean;
            r?: boolean;
          } | null;
          return h
            ? { h: Boolean(h.h), k: Boolean(h.k), r: Boolean(h.r) }
            : null;
        })()
      : null;

    const body = {
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
      title: { raw: row.title, zh: row.titleZh, en: row.titleEn },
      summary: { zh: row.summaryZh, en: row.summaryEn },
      editor_note: { zh: row.editorNoteZh, en: row.editorNoteEn },
      editor_analysis: {
        zh: row.editorAnalysisZh,
        en: row.editorAnalysisEn,
      },
      hkr: hkrPublic,
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
      event,
    };

    const etag = computeEtag(
      "public-item",
      etagSignal({
        id: row.id,
        commentary_at: row.commentaryAt?.toISOString() ?? "",
        enriched_at: row.enrichedAt?.toISOString() ?? "",
      }),
    );
    if (ifNoneMatch(req, etag)) return notModified(etag);

    return publicJson(body, etag, {
      sMaxAge: 120,
      staleWhileRevalidate: 600,
    });
  } catch (err) {
    console.error("[api/public/items/:id] failed", err);
    return publicError("server_error", 500);
  }
}
