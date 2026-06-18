import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { Item } from "@/components/feed/item";
import { FeedEmptyState } from "@/components/feed/empty-state";
import { DayBreak } from "../_day-break";
import { groupByDay, sortStoriesNewestFirst } from "@/lib/feed/group-by-day";
import { XHandlesSidebar } from "@/components/x-monitor/handles-sidebar";
import { getFeaturedStories } from "@/lib/items/live";
import { getShellChromeData } from "@/lib/shell/chrome-data";
import { getXHandles } from "@/lib/shell/x-handles";
import { appLocaleFromParam, type Story } from "@/lib/types";

export const revalidate = 60;

export default async function XMonitorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ handle?: string }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  const appLocale = appLocaleFromParam(locale);
  setRequestLocale(appLocale);

  const [handles, chrome] = await Promise.all([
    getXHandles().catch(() => []),
    getShellChromeData({ pulse: true }),
  ]);

  const activeHandle = sp.handle ?? null;
  const activeIsValid = activeHandle
    ? handles.some((h) => h.id === activeHandle)
    : false;

  const narrowedStories = await getFeaturedStories({
    tier: "all",
    locale: appLocale,
    sourceId: activeIsValid && activeHandle ? activeHandle : undefined,
    sourceKind: activeIsValid ? undefined : "x-api",
    limit: activeIsValid ? 200 : 80,
  }).catch((): Story[] => []);

  const grouped = groupByDay(sortStoriesNewestFirst(narrowedStories));
  const activeLabel: string = activeIsValid
    ? handles.find((h) => h.id === activeHandle)?.handle ?? activeHandle ?? ""
    : appLocale === "zh"
      ? "全部"
      : "all handles";

  return (
    <ViewShell
      locale={appLocale}
      stats={chrome.topBarStats}
      pulse={chrome.pulse}
      crumb={activeIsValid ? `~/x/${activeLabel.replace("@", "")}` : "~/x"}
      cmd={
        activeIsValid
          ? `tail -f x-timeline-${activeLabel.replace("@", "").toLowerCase()}.log`
          : "tail -f x-timeline.log"
      }
    >
      <main className="main">
        <PageHead
          en="X monitor"
          cjk="X 监控"
          count={narrowedStories.length}
          countLabel={appLocale === "zh" ? "推文" : "tweets"}
          live={<>{handles.length} {appLocale === "zh" ? "个账号" : "handles tracked"}</>}
        />

        <div
          className="saved-layout"
          style={{
            display: "grid",
            gridTemplateColumns: "240px 1fr",
            gap: 18,
            marginTop: 14,
          }}
        >
          <XHandlesSidebar
            locale={appLocale}
            handles={handles}
            activeHandle={activeIsValid ? activeHandle : null}
          />
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
                paddingBottom: 10,
                borderBottom: "1px dashed var(--border-1)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
            >
              <span style={{ color: "var(--accent-orange)", fontWeight: 700 }}>
                ▸ {activeLabel}
              </span>
              <span style={{ color: "var(--fg-3)", fontSize: 10.5 }}>
                {narrowedStories.length} {appLocale === "zh" ? "条" : "tweets"}
              </span>
            </div>
            <div className="feed">
              {Object.entries(grouped).map(([dayKey, list]) => (
                <div key={dayKey}>
                  <DayBreak dayKey={dayKey} />
                  {list.map((s) => (
                    <Item key={s.id} story={s} locale={appLocale} />
                  ))}
                </div>
              ))}
              {narrowedStories.length === 0 && (
                <FeedEmptyState>
                  {appLocale === "zh"
                    ? "此账号最近还没有原创推文"
                    : "no original posts from this handle yet"}
                </FeedEmptyState>
              )}
            </div>
          </div>
        </div>
      </main>
    </ViewShell>
  );
}
