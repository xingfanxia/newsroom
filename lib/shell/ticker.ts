import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources } from "@/db/schema";
import { highlightTierInSql } from "@/lib/items/tier-sql";
import type { TickerItem } from "@/components/feed/ticker";
import type { AppLocale } from "@/lib/types";

/**
 * Derive ticker items from recent high-importance stories. Pick the top N
 * scored in the last 24 hours, render label = source acronym, val = truncated
 * title, kind = up/hot/down based on tier. Falls back to an empty array when
 * no recent data is available — the Ticker component then hides.
 */
export async function getRecentTickerItems(
  locale: AppLocale,
  limit = 12,
): Promise<TickerItem[]> {
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  // Pinned to items_created_tier_idx: created_at bounds the range and tier
  // is filtered inside the index, so only the few matching rows are fetched
  // from the payload-heavy table pages. Turso can't run ANALYZE, so hot
  // queries never trust the stat-less planner (see scripts/ops/db-optimize.ts).
  const rows = await db().all<{
    title: string;
    titleEn: string | null;
    titleZh: string | null;
    importance: number | null;
    tier: string;
    sourceNameEn: string;
    sourceNameZh: string;
  }>(sql`
    SELECT ${items.title} AS title,
           ${items.titleEn} AS titleEn,
           ${items.titleZh} AS titleZh,
           ${items.importance} AS importance,
           ${items.tier} AS tier,
           ${sources.nameEn} AS sourceNameEn,
           ${sources.nameZh} AS sourceNameZh
    FROM ${items} INDEXED BY items_created_tier_idx
    INNER JOIN ${sources} ON ${items.sourceId} = ${sources.id}
    WHERE ${items.createdAt} >= ${sinceMs}
      AND ${items.importance} IS NOT NULL
      AND ${highlightTierInSql(items.tier)}
    ORDER BY ${items.importance} DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => {
    const rawTitle =
      locale === "en"
        ? r.titleEn ?? r.titleZh ?? r.title
        : r.titleZh ?? r.titleEn ?? r.title;
    const lab =
      (locale === "en" ? r.sourceNameEn : r.sourceNameZh)
        .toUpperCase()
        .slice(0, 20);
    const val = truncate(rawTitle, 44);
    const kind: TickerItem["kind"] =
      r.tier === "p1" ? "hot" : r.importance && r.importance >= 90 ? "up" : undefined;
    return {
      lab,
      val,
      kind,
      extra: r.importance != null ? `${r.importance}` : undefined,
    };
  });
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
