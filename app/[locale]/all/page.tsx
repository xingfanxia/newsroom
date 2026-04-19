import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { Item } from "@/components/feed/item";
import { DayPicker } from "@/components/feed/day-picker";
import { DayBreak } from "../_day-break";
import { HomeFilters, type SourcePreset } from "../_home-filters";
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

export default async function AllPostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ source?: string; date?: string }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const sourcePreset = coerceSource(sp.source);
  const sourceFilter = presetToFilter(sourcePreset);
  const activeDate = sp.date && DATE_RE.test(sp.date) ? sp.date : undefined;
  // When a day is picked, show everything from that day; otherwise show the
  // latest 120 across all days. 80 was too tight once backfill landed.
  const limit = activeDate ? 500 : 120;

  let stories: Story[] = [];
  try {
    stories = await getFeaturedStories({
      tier: "all",
      locale: locale as "zh" | "en",
      limit,
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
    getDayCounts(30).catch(() => []),
  ]);

  const grouped = groupByDay(stories);

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
        <DayPicker
          days={days}
          active={activeDate}
          basePath={`/${locale}/all`}
          preserveSource={sourcePreset}
          locale={locale as "en" | "zh"}
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
              no items match — check back in a few minutes
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
