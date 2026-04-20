import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { Item } from "@/components/feed/item";
import { DayBreak } from "../_day-break";
import { XHandlesSidebar } from "@/components/x-monitor/handles-sidebar";
import { getFeaturedStories } from "@/lib/items/live";
import { getPulseData, getRadarStats } from "@/lib/shell/dashboard-stats";
import { getXHandles } from "@/lib/shell/x-handles";
import type { Story } from "@/lib/types";

export const revalidate = 60;

export default async function XMonitorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ handle?: string }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);

  const [handles, stats, pulse] = await Promise.all([
    getXHandles().catch(() => []),
    getRadarStats().catch(() => ({
      items_today: 0,
      items_p1: 0,
      items_featured: 0,
      tracked_sources: 0,
    })),
    getPulseData().catch(() => []),
  ]);

  const activeHandle = sp.handle ?? null;
  const activeIsValid = activeHandle
    ? handles.some((h) => h.id === activeHandle)
    : false;

  const narrowedStories = await getFeaturedStories({
    tier: "all",
    locale: locale as "zh" | "en",
    sourceId: activeIsValid && activeHandle ? activeHandle : undefined,
    sourceKind: activeIsValid ? undefined : "x-api",
    limit: activeIsValid ? 200 : 80,
  }).catch((): Story[] => []);

  const grouped = groupByDay(narrowedStories);
  const activeLabel: string = activeIsValid
    ? handles.find((h) => h.id === activeHandle)?.handle ?? activeHandle ?? ""
    : locale === "zh"
      ? "全部"
      : "all handles";

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{
        tracked_sources: stats.tracked_sources,
        signal_ratio: 0.72,
      }}
      pulse={pulse}
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
          countLabel={locale === "zh" ? "推文" : "tweets"}
          live={<>{handles.length} {locale === "zh" ? "个账号" : "handles tracked"}</>}
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
            locale={locale as "en" | "zh"}
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
                {narrowedStories.length} {locale === "zh" ? "条" : "tweets"}
              </span>
            </div>
            <div className="feed">
              {Object.entries(grouped).map(([dayKey, list]) => (
                <div key={dayKey}>
                  <DayBreak date={new Date(dayKey)} />
                  {list.map((s) => (
                    <Item key={s.id} story={s} locale={locale as "en" | "zh"} />
                  ))}
                </div>
              ))}
              {narrowedStories.length === 0 && (
                <div style={{ padding: 60, color: "var(--fg-3)", textAlign: "center" }}>
                  {locale === "zh"
                    ? "此账号最近还没有原创推文"
                    : "no original posts from this handle yet"}
                </div>
              )}
            </div>
          </div>
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
