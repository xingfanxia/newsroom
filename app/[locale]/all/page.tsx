import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { Item } from "@/components/feed/item";
import { CalendarGrid } from "@/components/feed/calendar-grid";
import { DayBreak } from "../_day-break";
import { HomeFilters, type SourcePreset } from "../_home-filters";
import { groupByDay } from "@/lib/feed/group-by-day";
import { getFeaturedStories } from "@/lib/items/live";
import {
  getDayCounts,
  getPulseData,
  getRadarStats,
} from "@/lib/shell/dashboard-stats";
import type { Story } from "@/lib/types";

export const revalidate = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SOURCE_PRESETS = new Set<SourcePreset>([
  "all",
  "official",
  "newsletter",
  "media",
  "x",
  "research",
]);

function coerceSource(v: string | undefined): SourcePreset {
  return v && SOURCE_PRESETS.has(v as SourcePreset)
    ? (v as SourcePreset)
    : "all";
}

function presetToFilter(
  preset: SourcePreset,
): { sourceGroup?: string; sourceKind?: string } {
  switch (preset) {
    case "official":   return { sourceGroup: "vendor-official" };
    case "newsletter": return { sourceGroup: "newsletter" };
    case "media":      return { sourceGroup: "media" };
    case "research":   return { sourceGroup: "research" };
    case "x":          return { sourceKind: "x-api" };
    default:           return {};
  }
}

const PAGE_SIZE = 200;

export default async function AllPostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    source?: string;
    source_id?: string;
    date?: string;
    offset?: string;
  }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const sourceId = sp.source_id?.trim() || undefined;
  const sourcePreset = coerceSource(sp.source);
  const sourceFilter = sourceId ? { sourceId } : presetToFilter(sourcePreset);
  const activeDate = sp.date && DATE_RE.test(sp.date) ? sp.date : undefined;
  // When a day is picked, show everything from that day uncapped (500 is
  // the safety ceiling). Otherwise paginate in PAGE_SIZE chunks via `offset`.
  const offset = (() => {
    const n = Number.parseInt(sp.offset ?? "0", 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  })();
  const limit = activeDate ? 500 : PAGE_SIZE;

  let stories: Story[] = [];
  try {
    stories = await getFeaturedStories({
      tier: "all",
      locale: locale as "zh" | "en",
      limit,
      offset,
      date: activeDate,
      ...sourceFilter,
    });
  } catch {
    stories = [];
  }

  const [stats, pulse, days] = await Promise.all([
    getRadarStats().catch(() => ({
      items_today: 0,
      items_p1: 0,
      items_featured: 0,
      tracked_sources: 0,
    })),
    getPulseData().catch(() => []),
    getDayCounts(60).catch(() => []),
  ]);

  // /all is a chronological full-feed view — sort by publishedAt DESC
  // before grouping (the SQL already does this, but the explicit sort
  // protects against any caller that passes mixed-order input).
  const sorted = [...stories].sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
  const grouped = groupByDay(sorted);

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{
        tracked_sources: stats.tracked_sources,
        signal_ratio: 0.72,
      }}
      pulse={pulse}
      crumb="~/all"
      cmd="grep -v 'tier=excluded' stream.log"
    >
      <main className="main">
        <PageHead
          en={activeDate ? `posts · ${activeDate}` : "all posts"}
          cjk={activeDate ? `全部 · ${activeDate}` : "全部"}
          count={stories.length}
          countLabel="items"
        />
        {/* Reuse home filters but force tier=featured to hide the pill group visually
            — users get here via /all which itself IS tier=all on the server. We still
            want the source-filter pills. */}
        <HomeFilters tier="featured" source={sourcePreset} />
        <CalendarGrid
          days={days}
          active={activeDate}
          basePath={`/${locale}/all`}
          preserveSource={sourcePreset}
          preserveSourceId={sourceId}
          locale={locale as "en" | "zh"}
          monthsBack={3}
        />
        <div className="feed">
          {Object.entries(grouped).map(([dayKey, list]) => (
            <div key={dayKey}>
              <DayBreak dayKey={dayKey} />
              {list.map((s) => (
                <Item key={s.id} story={s} locale={locale as "en" | "zh"} />
              ))}
            </div>
          ))}
          {stories.length === 0 && (
            <div
              style={{ padding: 60, color: "var(--fg-3)", textAlign: "center" }}
            >
              no items match — check back in a few minutes
            </div>
          )}
        </div>

        {!activeDate && stories.length > 0 && (
          <Pagination
            offset={offset}
            pageSize={PAGE_SIZE}
            currentCount={stories.length}
            source={sourcePreset}
            sourceId={sourceId}
            locale={locale as "en" | "zh"}
          />
        )}
      </main>
    </ViewShell>
  );
}

function Pagination({
  offset,
  pageSize,
  currentCount,
  source,
  sourceId,
  locale,
}: {
  offset: number;
  pageSize: number;
  currentCount: number;
  source: SourcePreset;
  sourceId?: string;
  locale: "en" | "zh";
}) {
  const zh = locale === "zh";
  const build = (nextOffset: number) => {
    const qs = new URLSearchParams();
    if (sourceId) qs.set("source_id", sourceId);
    else if (source && source !== "all") qs.set("source", source);
    if (nextOffset > 0) qs.set("offset", String(nextOffset));
    const s = qs.toString();
    return `/${locale}/all${s ? `?${s}` : ""}`;
  };
  const prevOffset = Math.max(0, offset - pageSize);
  const nextOffset = offset + pageSize;
  const hasNext = currentCount >= pageSize;
  const hasPrev = offset > 0;
  const pageNum = Math.floor(offset / pageSize) + 1;

  return (
    <nav
      aria-label={zh ? "分页" : "pagination"}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "18px 0 40px",
        gap: 12,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--fg-3)",
        borderTop: "1px dashed var(--border-1)",
        marginTop: 18,
      }}
    >
      {hasPrev ? (
        <a href={build(prevOffset)} className="mini-btn">
          ← {zh ? "上一页" : "newer"}
        </a>
      ) : (
        <span style={{ opacity: 0.3 }}>← {zh ? "上一页" : "newer"}</span>
      )}
      <span style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {zh ? "第" : "page"} {pageNum} · {offset + 1}–{offset + currentCount}
      </span>
      {hasNext ? (
        <a href={build(nextOffset)} className="mini-btn">
          {zh ? "下一页" : "older"} →
        </a>
      ) : (
        <span style={{ opacity: 0.3 }}>{zh ? "下一页" : "older"} →</span>
      )}
    </nav>
  );
}

