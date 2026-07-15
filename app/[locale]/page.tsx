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
import { coerceSourcePreset } from "@/lib/feed/source-presets";
import {
  coerceHomeTier,
  coerceHomeView,
} from "@/lib/feed/home-filters";
import { groupByDay } from "@/lib/feed/group-by-day";
import { coerceFeedDateKey } from "@/lib/feed/page-query";
import { readCachedPublicHomePageModel } from "@/lib/public-content/home-page-model";
import { appLocaleFromParam } from "@/lib/types";

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
  const activeDate = coerceFeedDateKey(sp.date);
  // Default `today` (importance-sorted hot events). `daily` opts back into
  // the multi-day 3-per-day digest. Calendar drill-in (activeDate) overrides
  // both — that always shows the full archive for the picked day.
  const homeView: HomeView = coerceHomeView(sp.view);
  const { stories, chrome, topics, policy, tickerItems, days } =
    await readCachedPublicHomePageModel({
      locale: appLocale,
      tier,
      sourceId,
      sourcePreset,
      activeDate,
      homeView,
    });
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
