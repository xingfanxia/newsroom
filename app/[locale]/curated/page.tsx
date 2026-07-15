import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { Item } from "@/components/feed/item";
import { FeedEmptyState } from "@/components/feed/empty-state";
import { FeedArchivePagination } from "@/components/feed/archive-pagination";
import { CalendarGrid } from "@/components/feed/calendar-grid";
import { DayBreak } from "../_day-break";
import { groupByDay, sortStoriesNewestFirst } from "@/lib/feed/group-by-day";
import {
  coerceFeedDateKey,
  coerceFeedOffset,
  feedPageLimitForDate,
  FEED_PAGE_SIZE,
} from "@/lib/feed/page-query";
import { deriveDayCounts } from "@/lib/public-content/derive";
import { readPublicPageSnapshot } from "@/lib/public-content/page-data";
import { queryPublicFeed } from "@/lib/public-content/query";
import { shellChromeDataFromSnapshot } from "@/lib/shell/chrome-data";
import { appLocaleFromParam } from "@/lib/types";

export const revalidate = 60;

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
  const appLocale = appLocaleFromParam(locale);
  setRequestLocale(appLocale);
  const sourceId = sp.source_id?.trim() || undefined;
  const activeDate = coerceFeedDateKey(sp.date);
  const offset = coerceFeedOffset(sp.offset);
  const limit = feedPageLimitForDate(activeDate);

  const { state, nowMs } = await readPublicPageSnapshot();
  const stories = queryPublicFeed(
    state,
    {
      tier: "all",
      locale: appLocale,
      limit,
      offset,
      date: activeDate,
      curatedOnly: true,
      sourceId,
      // W8: bound the default /curated scan to 30d (seeks items_feed_recent_idx).
      // Skipped when pinned to a single source; ignored when a date is picked.
      recencyFloorDays: sourceId ? undefined : 30,
    },
    { nowMs },
  ).items;

  const chrome = shellChromeDataFromSnapshot(state, nowMs, { pulse: true });
  // Curated calendar mirrors the feed's curatedOnly filter so cells
  // count only AX-curated leads — same contract as the home page.
  const days = deriveDayCounts(state, 60, { curatedOnly: true }, nowMs);

  const grouped = groupByDay(sortStoriesNewestFirst(stories));
  const zh = appLocale === "zh";

  return (
    <ViewShell
      locale={appLocale}
      stats={chrome.topBarStats}
      pulse={chrome.pulse}
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
          basePath={`/${appLocale}/curated`}
          preserveSourceId={sourceId}
          locale={appLocale}
          monthsBack={2}
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
              {zh
                ? "暂无严选内容 — 手动在 sources 表把信源标为 curated=true 可加入此页"
                : "no curated items yet — flag a source with curated=true to surface it here"}
            </FeedEmptyState>
          )}
        </div>
        {!activeDate && stories.length > 0 && (
          <FeedArchivePagination
            basePath={`/${appLocale}/curated`}
            offset={offset}
            pageSize={FEED_PAGE_SIZE}
            currentCount={stories.length}
            locale={appLocale}
            preservedParams={{ source_id: sourceId }}
          />
        )}
      </main>
    </ViewShell>
  );
}
