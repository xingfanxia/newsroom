import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { Item } from "@/components/feed/item";
import { CalendarGrid } from "@/components/feed/calendar-grid";
import { DayBreak } from "../_day-break";
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
const PAGE_SIZE = 200;
const PAPER_TAGS = ["arxiv", "paper"];

/**
 * 论文 / papers — research-paper feed split out of the main news view.
 * Filters by source.tags && {arxiv,paper}, which catches arXiv categories +
 * HuggingFace-papers digests without sweeping in research-group blogs (yage,
 * ruanyifeng) that share the group but aren't papers.
 */
export default async function PapersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    source_id?: string;
    date?: string;
    offset?: string;
  }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const sourceId = sp.source_id?.trim() || undefined;
  const activeDate = sp.date && DATE_RE.test(sp.date) ? sp.date : undefined;
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
      includeSourceTags: PAPER_TAGS,
      sourceId,
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
    // Papers calendar mirrors the feed's includeSourceTags filter so cells
    // count only paper-tagged leads — same contract as the home page.
    getDayCounts(60, { includeSourceTags: PAPER_TAGS }).catch(() => []),
  ]);

  const sorted = [...stories].sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
  const grouped = groupByDay(sorted);
  const zh = locale === "zh";

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{
        tracked_sources: stats.tracked_sources,
        signal_ratio: 0.72,
      }}
      pulse={pulse}
      crumb="~/papers"
      cmd="grep -E 'arxiv|paper' sources/tags"
    >
      <main className="main">
        <PageHead
          en={activeDate ? `papers · ${activeDate}` : "papers"}
          cjk={activeDate ? `论文 · ${activeDate}` : "论文"}
          count={stories.length}
          countLabel={zh ? "篇" : "papers"}
        />
        <CalendarGrid
          days={days}
          active={activeDate}
          basePath={`/${locale}/papers`}
          preserveSourceId={sourceId}
          locale={locale as "en" | "zh"}
          monthsBack={2}
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
              {zh
                ? "暂无论文 — arXiv 与 HF Papers 信源没有产出"
                : "no papers yet — arXiv and HF Papers feeds returned nothing"}
            </div>
          )}
        </div>
      </main>
    </ViewShell>
  );
}
