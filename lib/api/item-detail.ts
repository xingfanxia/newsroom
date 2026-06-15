import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clusters, items, sources } from "@/db/schema";
import { etagSignal } from "@/lib/api/public-helpers";
import {
  INVALID_ROUTE_ID_ERROR,
  parsePositiveRouteId,
  type PositiveRouteIdResult,
} from "@/lib/api/route-params";
import { toPublicHkr, type PublicHkr } from "@/lib/api/story-item-fields";
import type { Story } from "@/lib/types";

type Hkr = Story["hkr"];

type DetailTags = {
  capabilities: string[];
  entities: string[];
  topics: string[];
};

async function getItemDetailRow(id: number) {
  const [row] = await db()
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

  return row ?? null;
}

export type ItemDetailRow = NonNullable<
  Awaited<ReturnType<typeof getItemDetailRow>>
>;

type DetailSource = {
  id: string;
  name_en: string;
  name_zh: string;
  kind: string;
  group: string;
  locale: string;
  url: string;
};

type LocalizedText = {
  zh: string | null;
  en: string | null;
};

type DetailTitle = LocalizedText & {
  raw: string;
};

type DetailEvent = {
  cluster_id: number;
  coverage: number | null;
  tier: string | null;
  importance: number | null;
  first_seen_at: string | null;
  latest_member_at: string | null;
  canonical_title: LocalizedText;
  editor_note: LocalizedText;
  editor_analysis: LocalizedText;
  members_url: string;
};

type V1DetailEvent = DetailEvent & {
  verified_at: string | null;
  commentary_at: string | null;
};

export type ItemDetailRouteId = PositiveRouteIdResult;
type ItemDetailRouteLookupError = typeof INVALID_ROUTE_ID_ERROR | "not_found";
type ItemDetailRouteLookup =
  | { ok: true; id: number; row: ItemDetailRow }
  | { ok: false; error: ItemDetailRouteLookupError; status: 400 | 404 };
type AgentItemDetailRouteLookup =
  | { ok: true; id: number; payload: V1ItemDetail }
  | { ok: false; error: ItemDetailRouteLookupError; status: 400 | 404 };

export type V1ItemDetail = {
  id: string;
  source: DetailSource;
  title: DetailTitle;
  summary: LocalizedText;
  editor_note: LocalizedText;
  editor_analysis: LocalizedText;
  reasoning: {
    legacy: string | null;
    zh: string | null;
    en: string | null;
  };
  hkr: Hkr | null;
  tags: DetailTags;
  importance: number | null;
  tier: string | null;
  url: string;
  canonical_url: string;
  author: string | null;
  published_at: string;
  enriched_at: string | null;
  commentary_at: string | null;
  body_md: string | null;
  body_rss: string;
  event: V1DetailEvent | null;
};

export type PublicItemDetail = Omit<
  V1ItemDetail,
  "reasoning" | "body_rss" | "hkr" | "event"
> & {
  hkr: PublicHkr | null;
  event: DetailEvent | null;
};

export function parseItemDetailRouteId(rawId: string): ItemDetailRouteId {
  return parsePositiveRouteId(rawId);
}

export async function getItemDetailRouteRow(
  rawId: string,
): Promise<ItemDetailRouteLookup> {
  const parsed = parseItemDetailRouteId(rawId);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, status: 400 };
  }

  const row = await getItemDetailRow(parsed.id);
  if (!row) {
    return { ok: false, error: "not_found", status: 404 };
  }

  return { ok: true, id: parsed.id, row };
}

export async function getAgentItemDetailRoutePayload(
  rawId: string,
): Promise<AgentItemDetailRouteLookup> {
  const found = await getItemDetailRouteRow(rawId);
  if (!found.ok) return found;
  return { ok: true, id: found.id, payload: toV1ItemDetail(found.row) };
}

function iso(d: Date | null | undefined): string | null {
  return d?.toISOString() ?? null;
}

function detailSource(row: ItemDetailRow): DetailSource {
  return {
    id: row.sourceId,
    name_en: row.sourceNameEn,
    name_zh: row.sourceNameZh,
    kind: row.sourceKind,
    group: row.sourceGroup,
    locale: row.sourceLocale,
    url: row.sourceUrl,
  };
}

function detailTags(tags: unknown): DetailTags {
  const tagBag = (tags ?? {}) as {
    capabilities?: string[];
    entities?: string[];
    topics?: string[];
  };
  return {
    capabilities: tagBag.capabilities ?? [],
    entities: tagBag.entities ?? [],
    topics: tagBag.topics ?? [],
  };
}

function isEvent(row: ItemDetailRow): boolean {
  return row.clusterId != null && (row.clusterMemberCount ?? 0) > 1;
}

function detailEvent(
  row: ItemDetailRow,
  membersUrl: string,
): DetailEvent | null {
  if (!isEvent(row) || row.clusterId == null) return null;
  return {
    cluster_id: row.clusterId,
    coverage: row.clusterMemberCount,
    tier: row.clusterEventTier,
    importance: row.clusterImportance,
    first_seen_at: iso(row.clusterFirstSeenAt),
    latest_member_at: iso(row.clusterLatestMemberAt),
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
    members_url: membersUrl,
  };
}

function baseDetail(row: ItemDetailRow) {
  return {
    id: String(row.id),
    source: detailSource(row),
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
    tags: detailTags(row.tags),
    importance: row.importance,
    tier: row.tier,
    url: row.url,
    canonical_url: row.canonicalUrl,
    author: row.author,
    published_at: row.publishedAt.toISOString(),
    enriched_at: iso(row.enrichedAt),
    commentary_at: iso(row.commentaryAt),
    body_md: row.bodyMd,
  };
}

export function toV1ItemDetail(row: ItemDetailRow): V1ItemDetail {
  const event = detailEvent(row, `/api/v1/events/${row.clusterId}/members`);
  return {
    ...baseDetail(row),
    reasoning: {
      legacy: row.reasoning,
      zh: row.reasoningZh,
      en: row.reasoningEn,
    },
    hkr: (row.hkr as Hkr) ?? null,
    body_rss: row.body,
    event: event
      ? {
          ...event,
          verified_at: iso(row.clusterVerifiedAt),
          commentary_at: iso(row.clusterCommentaryAt),
        }
      : null,
  };
}

export function toPublicItemDetail(row: ItemDetailRow): PublicItemDetail {
  return {
    ...baseDetail(row),
    hkr: toPublicHkr((row.hkr as Hkr) ?? null),
    event: detailEvent(row, `/api/public/events/${row.clusterId}/members`),
  };
}

export function publicItemDetailEtagSignal(row: ItemDetailRow): string {
  return etagSignal({
    id: row.id,
    enriched_at: iso(row.enrichedAt),
    commentary_at: iso(row.commentaryAt),
    cluster_id: row.clusterId,
    cluster_coverage: row.clusterMemberCount,
    cluster_latest_member_at: iso(row.clusterLatestMemberAt),
    cluster_commentary_at: iso(row.clusterCommentaryAt),
  });
}
