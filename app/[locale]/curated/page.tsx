import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { Item } from "@/components/feed/item";
import { CalendarGrid } from "@/components/feed/calendar-grid";
import { DayBreak } from "../_day-break";
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

/**
 * AX 严选 / curated — operator hand-picked sources (sources.curated = true).
 * Currently: AI 群聊日报. Unlike /podcasts which filters by source group,
 * this tab is an explicit editorial opt-in list — add a source via
 * `UPDATE sources SET curated = true WHERE id = '...'`.
 *
 * Shows tier = all (everything non-excluded) because the whole point of the
 * tab is that these sources are trusted by the operator — the scorer's
 * importance ranking still orders them, but nothing gets hidden.
 */
export default async function CuratedPage({
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
      curatedOnly: true,
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
    // Curated calendar mirrors the feed's curatedOnly filter so cells
    // count only AX-curated leads — same contract as the home page.
    getDayCounts(60, { curatedOnly: true }).catch(() => []),
  ]);

  const grouped = groupByDay(stories);
  const zh = locale === "zh";

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{
        tracked_sources: stats.tracked_sources,
        signal_ratio: 0.72,
      }}
      pulse={pulse}
      crumb="~/curated"
      cmd="grep -l 'curated=true' sources/"
    >
      <main className="main">
        <PageHead
          en={activeDate ? `curated · ${activeDate}` : "ax curated"}
          cjk={activeDate ? `AX 严选 · ${activeDate}` : "AX 严选"}
          count={stories.length}
          countLabel={zh ? "条" : "items"}
        />
        <CalendarGrid
          days={days}
          active={activeDate}
          basePath={`/${locale}/curated`}
          preserveSourceId={sourceId}
          locale={locale as "en" | "zh"}
          monthsBack={2}
        />
        <div className="feed">
          {Object.entries(grouped).map(([dayKey, list]) => (
            <div key={dayKey}>
              <DayBreak date={new Date(dayKey)} />
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
                ? "暂无严选内容 — 手动在 sources 表把信源标为 curated=true 可加入此页"
                : "no curated items yet — flag a source with curated=true to surface it here"}
            </div>
          )}
        </div>
      </main>
    </ViewShell>
  );
}

function groupByDay(stories: Story[]): Record<string, Story[]> {
  const sorted = [...stories].sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
  const byDay: Record<string, Story[]> = {};
  for (const s of sorted) {
    const d = new Date(s.publishedAt);
    const canonical = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
    ).toISOString();
    (byDay[canonical] ??= []).push(s);
  }
  return byDay;
}
