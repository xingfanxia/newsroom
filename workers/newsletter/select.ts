/**
 * Daily column selection: today's 严选 ∪ top 15 of 热点聚合,
 * deduped by cluster (one event = one row), capped at 20 unique items.
 *
 * Window: rolling 24h ending at the cron-firing hour, snapped for idempotency
 * across re-runs within the same hour.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { computeDailyNewsletterWindow } from "@/workers/newsletter/windows";

export type SelectedRow = {
  id: number;
  clusterId: number | null;
  coverage: number;
  publishedAt: Date;
  enrichedAt: Date | null;
  titleZh: string | null;
  titleEn: string | null;
  title: string;
  canonicalTitleZh: string | null;
  canonicalTitleEn: string | null;
  summaryZh: string | null;
  summaryEn: string | null;
  noteZh: string | null;
  noteEn: string | null;
  importance: number | null;
  tier: string | null;
  tags: unknown;
  sourceTags: string[] | null;
  fromCurated: boolean;
};

export type SelectionResult = {
  rows: SelectedRow[];
  skipReason?: "insufficient-signal";
  windowStart: Date;
  windowEnd: Date;
};

const MIN_POOL = 5;
const HOT_TOP_N = 25; // raise pre-dedup cap; cluster-dedup will collapse multi-source events
const HARD_CAP = 20;

/**
 * Computes [start, end) snapped to the cron-firing hour for idempotency.
 * Re-runs within the same hour land on the same window.
 */
export function computeColumnWindow(now: Date): {
  start: Date;
  end: Date;
} {
  return computeDailyNewsletterWindow(now);
}

// Raw libSQL wire shape (client.all): none of the ORM's decoding runs on raw
// SQL, so timestamp_ms columns arrive as ms-epoch INTEGERs, json columns as
// unparsed TEXT, and a selected boolean literal as 0/1.
type RawRow = {
  id: number;
  cluster_id: number | null;
  coverage: number | null;
  published_at: number;
  enriched_at: number | null;
  title_zh: string | null;
  title_en: string | null;
  title: string;
  canonical_title_zh: string | null;
  canonical_title_en: string | null;
  summary_zh: string | null;
  summary_en: string | null;
  editor_note_zh: string | null;
  editor_note_en: string | null;
  importance: number | null;
  tier: string | null;
  tags: string | null;
  source_tags: string | null;
  from_curated: number;
};

function parseJsonColumn(value: string | null): unknown {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function rawToSelected(r: RawRow): SelectedRow {
  return {
    id: r.id,
    clusterId: r.cluster_id,
    coverage: r.coverage ?? 1,
    // timestamp_ms columns come back as ms-epoch integers on raw SQL.
    publishedAt: new Date(r.published_at),
    enrichedAt: r.enriched_at == null ? null : new Date(r.enriched_at),
    titleZh: r.title_zh,
    titleEn: r.title_en,
    title: r.title,
    canonicalTitleZh: r.canonical_title_zh,
    canonicalTitleEn: r.canonical_title_en,
    summaryZh: r.summary_zh,
    summaryEn: r.summary_en,
    noteZh: r.editor_note_zh,
    noteEn: r.editor_note_en,
    importance: r.importance,
    tier: r.tier,
    // json columns come back as raw TEXT on raw SQL — parse at this boundary.
    tags: parseJsonColumn(r.tags),
    sourceTags: parseJsonColumn(r.source_tags) as string[] | null,
    fromCurated: r.from_curated === 1,
  };
}

/**
 * Selects the daily pool. Returns { rows: [], skipReason: "insufficient-signal" }
 * when fewer than 5 items qualify — caller writes nothing and the cron tick is
 * a no-op.
 *
 * Cluster-dedup: items belonging to the same `cluster_id` collapse to the
 * highest-importance representative; coverage = cluster.member_count for events,
 * 1 for singletons.
 */
export async function selectDailyColumnPool(
  now: Date,
): Promise<SelectionResult> {
  const { start, end } = computeDailyNewsletterWindow(now);
  const client = db();

  const curatedRaw = await client.all<RawRow>(sql`
    SELECT
      i.id, i.cluster_id,
      COALESCE(c.member_count, 1) AS coverage,
      i.published_at, i.enriched_at,
      i.title_zh, i.title_en, i.title,
      c.canonical_title_zh, c.canonical_title_en,
      i.summary_zh, i.summary_en,
      i.editor_note_zh, i.editor_note_en,
      i.importance, i.tier, i.tags,
      s.tags AS source_tags,
      true AS from_curated
    FROM items i
    JOIN sources s ON s.id = i.source_id
    LEFT JOIN clusters c ON c.id = i.cluster_id
    WHERE s.curated = true
      AND i.published_at >= ${start.getTime()}
      AND i.published_at <  ${end.getTime()}
      AND i.enriched_at IS NOT NULL
    ORDER BY i.importance DESC NULLS LAST, i.published_at DESC
  `);

  const hotRaw = await client.all<RawRow>(sql`
    SELECT
      i.id, i.cluster_id,
      COALESCE(c.member_count, 1) AS coverage,
      i.published_at, i.enriched_at,
      i.title_zh, i.title_en, i.title,
      c.canonical_title_zh, c.canonical_title_en,
      i.summary_zh, i.summary_en,
      i.editor_note_zh, i.editor_note_en,
      i.importance, i.tier, i.tags,
      s.tags AS source_tags,
      false AS from_curated
    FROM items i
    JOIN sources s ON s.id = i.source_id
    LEFT JOIN clusters c ON c.id = i.cluster_id
    WHERE i.published_at >= ${start.getTime()}
      AND i.published_at <  ${end.getTime()}
      AND i.enriched_at IS NOT NULL
    ORDER BY i.importance DESC NULLS LAST, i.published_at DESC
    LIMIT ${HOT_TOP_N}
  `);

  const curated = curatedRaw.map(rawToSelected);
  const hot = hotRaw.map(rawToSelected);

  // Item-level dedup: curated wins (preserves fromCurated metadata).
  const seenItem = new Set<number>();
  const seenCluster = new Set<number>();
  const merged: SelectedRow[] = [];

  function tryAdd(r: SelectedRow): void {
    if (seenItem.has(r.id)) return;
    if (r.clusterId != null && seenCluster.has(r.clusterId)) return;
    seenItem.add(r.id);
    if (r.clusterId != null) seenCluster.add(r.clusterId);
    merged.push(r);
  }

  for (const r of curated) tryAdd(r);
  for (const r of hot) {
    if (merged.length >= HARD_CAP) break;
    tryAdd(r);
  }

  const rows = merged.slice(0, HARD_CAP);

  if (rows.length < MIN_POOL) {
    return {
      rows: [],
      skipReason: "insufficient-signal",
      windowStart: start,
      windowEnd: end,
    };
  }

  return { rows, windowStart: start, windowEnd: end };
}
