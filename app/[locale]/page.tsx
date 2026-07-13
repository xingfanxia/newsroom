import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { Ticker } from "@/components/feed/ticker";
import { Item } from "@/components/feed/item";
import { FeedEmptyState } from "@/components/feed/empty-state";
import { RightRail } from "@/components/feed/right-rail";
import { CalendarGrid } from "@/components/feed/calendar-grid";
import { DayBreak } from "./_day-break";
import { HomeFilters, type HomeTier, type HomeView } from "./_home-filters";
import {
  coerceSourcePreset,
  sourcePresetToFeedFilter,
} from "@/lib/feed/source-presets";
import {
  coerceHomeTier,
  coerceHomeView,
  DEFAULT_HOME_TIER,
} from "@/lib/feed/home-filters";
import { groupByDay } from "@/lib/feed/group-by-day";
import { coerceFeedDateKey, feedPageLimitForDate } from "@/lib/feed/page-query";
import { getFeaturedStories } from "@/lib/items/live";
import {
  getDayCounts,
  getPolicySummary,
  getTopTopics,
} from "@/lib/shell/dashboard-stats";
import { getShellChromeData } from "@/lib/shell/chrome-data";
import { getRecentTickerItems } from "@/lib/shell/ticker";
import { mockStories } from "@/lib/mock/stories";
import { appLocaleFromParam, type Story } from "@/lib/types";

export const revalidate = 60;

const FALLBACK_TICKER = [
  { lab: "OPUS 4.7", val: "score engine online", kind: "up" as const, extra: "live" },
  { lab: "AX-RADAR", val: "ingest pipeline healthy", kind: "hot" as const, extra: "ok" },
];

// Empty default — WatchlistPanel fetches the user's own terms from
// `/api/tweaks` on mount. If they've never added any, the panel renders the
// "no terms yet" empty state with an inline add control. No more demo
// placeholder queries leaking into production.
const DEFAULT_WATCHLIST: { q: string; hits: number; delta: number }[] = [];

export default async function HotNewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    tier?: string;
    source?: string;
    source_id?: string;
    date?: string;
    view?: string;
  }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  const appLocale = appLocaleFromParam(locale);
  if (sp.tier === "all") {
    const qs = new URLSearchParams();
    if (sp.source) qs.set("source", sp.source);
    if (sp.source_id) qs.set("source_id", sp.source_id);
    if (sp.date) qs.set("date", sp.date);
    const search = qs.toString();
    redirect(`/${appLocale}/all${search ? `?${search}` : ""}`);
  }
  setRequestLocale(appLocale);
  const tier: HomeTier = coerceHomeTier(sp.tier);
  // source_id pins a specific publisher and overrides any preset bucket.
  const sourceId = sp.source_id?.trim() || undefined;
  const sourcePreset = coerceSourcePreset(sp.source);
  const sourceFilter = sourceId
    ? { sourceId }
    : sourcePresetToFeedFilter(sourcePreset);
  const activeDate = coerceFeedDateKey(sp.date);
  // Default `today` (importance-sorted hot events). `daily` opts back into
  // the multi-day 3-per-day digest. Calendar drill-in (activeDate) overrides
  // both — that always shows the full archive for the picked day.
  const homeView: HomeView = coerceHomeView(sp.view);
  // Day picked → show everything curated that day. Unfiltered top-featured
  // view bumps to 120 (was 40 and people kept asking where the rest went).
  const limit = feedPageLimitForDate(activeDate, 120);

  // Daily-highlights mode kicks in only when the user hasn't pinned a date,
  // a specific source, a non-default tier filter, AND has explicitly opted
  // into ?view=daily. Otherwise the user is on the default ("今日热点")
  // or drilling into a filter — both want hot-window/today semantics, not
  // the multi-day digest.
  const dailyHighlights =
    !activeDate &&
    !sourceId &&
    sourcePreset === "all" &&
    tier === DEFAULT_HOME_TIER &&
    homeView === "daily";

  // W8 read-budget floor: bound the default feed scan to the recent window so
  // it seeks items_feed_recent_idx instead of scanning every enriched row.
  // Skipped when a source filter is active (source views stay unbounded);
  // ignored inside buildFeedWhere when a date is picked (calendar reaches any
  // day). `today` view needs only ~2 days of content → 7d is generous; the
  // daily-highlights archive browses back → 30d.
  const feedFloorDays =
    sourceId || sourcePreset !== "all"
      ? undefined
      : dailyHighlights
        ? 30
        : 7;

  let stories: Story[] = [];
  try {
    stories = await getFeaturedStories({
      tier,
      locale: appLocale,
      limit,
      date: activeDate,
      // View selection:
      //   - Specific date picked → archive view (full day's items, no time clip)
      //   - Daily-highlights default → archive view too (we want top-per-day
      //     across history, not just hot clusters from the last 24h)
      //   - Otherwise (tab/source drill-in) → today view (trending events
      //     with hot-window + start-of-yesterday rescue, see lib/items/live.ts)
      view: activeDate || dailyHighlights ? "archive" : "today",
      recencyFloorDays: feedFloorDays,
      // Default home (no filter): up to 3 stories per day at importance >= 80.
      // Surfaces the day's notable events (Apple CEO transition, GPT-5.5 release,
      // Google→Anthropic $40B + secondary stories like DRAM shortages, OpenAI
      // exec departures) instead of mid-tier noise. Tab/source filters opt out
      // so power users still get the full feed for their slice. Threshold 80
      // (vs 85) admits a few more borderline-major stories per day; cap of 3
      // gives a "day digest" feel without burying the headline behind volume.
      //
      // recentDayRescueDays: 3 — Stage D cluster scoring lags ingestion by
      // ~1-2 days. Without rescue, recent days where leads sit at imp 60-79
      // disappear entirely from the home feed and the user sees "stuff from
      // 3 days ago first." The OR-bypass admits any lead from the last 3
      // calendar days regardless of threshold; maxPerDay=3 still bounds
      // each rescued day to its top-3 by importance.
      ...(dailyHighlights
        ? { minImportance: 80, maxPerDay: 3, recentDayRescueDays: 3 }
        : {}),
      ...sourceFilter,
    });
  } catch {
    stories = [];
  }

  // Cold-start fallback: if there's literally no enriched content, show mock
  // so the shell renders something sensible.
  if (stories.length === 0 && tier === DEFAULT_HOME_TIER && sourcePreset === "all" && !sourceId && !activeDate) {
    try {
      const probe = await getFeaturedStories({
        tier: "all",
        locale: appLocale,
        limit: 1,
      });
      if (probe.length === 0) stories = mockStories;
    } catch {
      stories = mockStories;
    }
  }

  const [chrome, topics, policy, tickerItems, days] = await Promise.all([
    getShellChromeData({ pulse: true, signalRatio: "fromRadar" }),
    getTopTopics().catch(() => []),
    getPolicySummary().catch(() => ({ version: "v1", lastIterAt: null })),
    getRecentTickerItems(appLocale).catch(() => []),
    // Calendar must apply the SAME filters as the feed — otherwise the cell
    // count can over-promise items that will not render after filtering.
    getDayCounts(60, {
      tier: DEFAULT_HOME_TIER,
    }).catch(() => []),
  ]);
  const ticker = tickerItems.length > 0 ? tickerItems : FALLBACK_TICKER;

  // Both today and archive views render chronologically (published_at DESC
  // with importance as tiebreaker), so day-grouping is meaningful in both
  // — the user sees clear "today / yesterday / 2d ago" boundaries.
  const grouped = groupByDay(stories);

  return (
    <ViewShell
      locale={appLocale}
      stats={chrome.topBarStats}
      pulse={chrome.pulse}
      crumb="~/feed"
      cmd="tail -f signal.log"
    >
      <main className="main">
        <PageHead
          en={activeDate ? `hot events · ${activeDate}` : "hot events"}
          cjk={activeDate ? `热点聚合 · ${activeDate}` : "热点聚合"}
          count={stories.length}
          live={<>live · {chrome.radarStats.items_today} today</>}
          policyLabel={`policy ${policy.version}`}
        />
        <Ticker items={ticker} />
        <HomeFilters tier={tier} source={sourcePreset} view={homeView} />
        <CalendarGrid
          days={days}
          active={activeDate}
          basePath={`/${appLocale}`}
          preserveSource={sourcePreset}
          preserveSourceId={sourceId}
          locale={appLocale}
          monthsBack={2}
        />
        <div className="feed">
          {Object.entries(grouped).map(([dayKey, dayStories]) => (
            <div key={dayKey}>
              <DayBreak dayKey={dayKey} />
              {dayStories.map((s) => (
                <Item key={s.id} story={s} locale={appLocale} />
              ))}
            </div>
          ))}
          {stories.length === 0 && (
            <FeedEmptyState>
              no items match — try widening filters
            </FeedEmptyState>
          )}
        </div>
      </main>
      <RightRail
        stats={chrome.radarStats}
        watchlist={DEFAULT_WATCHLIST}
        topics={topics}
        policyVersion={policy.version}
        lastIterAt={policy.lastIterAt ?? undefined}
      />
    </ViewShell>
  );
}
