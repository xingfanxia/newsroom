import { desc, gte, and, sql, isNotNull, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources } from "@/db/schema";
import type { TickerItem } from "@/components/feed/ticker";

/**
 * Derive ticker items from recent high-importance stories. Pick the top N
 * scored in the last 24 hours, render label = source acronym, val = truncated
 * title, kind = up/hot/down based on tier. Falls back to an empty array when
 * no recent data is available — the Ticker component then hides.
 */
export async function getRecentTickerItems(
  locale: "zh" | "en",
  limit = 12,
): Promise<TickerItem[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db()
    .select({
      title: items.title,
      titleEn: items.titleEn,
      titleZh: items.titleZh,
      importance: items.importance,
      tier: items.tier,
      sourceNameEn: sources.nameEn,
      sourceNameZh: sources.nameZh,
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(
      and(
        gte(items.createdAt, since),
        isNotNull(items.importance),
        sql`${items.tier} IN ('featured', 'p1')`,
      ),
    )
    .orderBy(desc(items.importance))
    .limit(limit);

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
