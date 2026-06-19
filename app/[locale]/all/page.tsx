import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { Item } from "@/components/feed/item";
import { FeedEmptyState } from "@/components/feed/empty-state";
import { FeedArchivePagination } from "@/components/feed/archive-pagination";
import { CalendarGrid } from "@/components/feed/calendar-grid";
import { DayBreak } from "../_day-break";
import { HomeFilters } from "../_home-filters";
import {
  coerceSourcePreset,
  sourcePresetToFeedFilter,
} from "../_source-presets";
import { groupByDay, sortStoriesNewestFirst } from "@/lib/feed/group-by-day";
import { DEFAULT_HOME_TIER } from "@/lib/feed/home-filters";
import {
  coerceFeedDateKey,
  coerceFeedOffset,
  feedPageLimitForDate,
  FEED_PAGE_SIZE,
} from "@/lib/feed/page-query";
import { getFeaturedStories } from "@/lib/items/live";
import {
  getDayCounts,
} from "@/lib/shell/dashboard-stats";
import { getShellChromeData } from "@/lib/shell/chrome-data";
import { appLocaleFromParam, type Story } from "@/lib/types";

export const revalidate = 60;

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
  const appLocale = appLocaleFromParam(locale);
  setRequestLocale(appLocale);
  const sourceId = sp.source_id?.trim() || undefined;
  const sourcePreset = coerceSourcePreset(sp.source);
  const sourceFilter = sourceId
    ? { sourceId }
    : sourcePresetToFeedFilter(sourcePreset);
  const activeDate = coerceFeedDateKey(sp.date);
  // When a day is picked, show everything from that day uncapped (500 is
  // the safety ceiling). Otherwise paginate in shared page-size chunks.
  const offset = coerceFeedOffset(sp.offset);
  const limit = feedPageLimitForDate(activeDate);

  let stories: Story[] = [];
  try {
    stories = await getFeaturedStories({
      tier: "all",
      locale: appLocale,
      limit,
      offset,
      date: activeDate,
      ...sourceFilter,
    });
  } catch {
    stories = [];
  }

  const [chrome, days] = await Promise.all([
    getShellChromeData({ pulse: true }),
    getDayCounts(60).catch(() => []),
  ]);

  // /all is a chronological full-feed view — sort by publishedAt DESC
  // before grouping (the SQL already does this, but the explicit sort
  // protects against any caller that passes mixed-order input).
  const grouped = groupByDay(sortStoriesNewestFirst(stories));
  const paginationParams = sourceId
    ? { source_id: sourceId }
    : sourcePreset !== "all"
      ? { source: sourcePreset }
      : undefined;

  return (
    <ViewShell
      locale={appLocale}
      stats={chrome.topBarStats}
      pulse={chrome.pulse}
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
        <HomeFilters tier={DEFAULT_HOME_TIER} source={sourcePreset} />
        <CalendarGrid
          days={days}
          active={activeDate}
          basePath={`/${appLocale}/all`}
          preserveSource={sourcePreset}
          preserveSourceId={sourceId}
          locale={appLocale}
          monthsBack={3}
        />
        <div className="feed">
          {Object.entries(grouped).map(([dayKey, list]) => (
            <div key={dayKey}>
              <DayBreak dayKey={dayKey} />
              {list.map((s) => (
                <Item key={s.id} story={s} locale={appLocale} />
              ))}
            </div>
          ))}
          {stories.length === 0 && (
            <FeedEmptyState>
              no items match — check back in a few minutes
            </FeedEmptyState>
          )}
        </div>

        {!activeDate && stories.length > 0 && (
          <FeedArchivePagination
            basePath={`/${appLocale}/all`}
            offset={offset}
            pageSize={FEED_PAGE_SIZE}
            currentCount={stories.length}
            locale={appLocale}
            preservedParams={paginationParams}
          />
        )}
      </main>
    </ViewShell>
  );
}
