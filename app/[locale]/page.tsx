import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { Ticker } from "@/components/feed/ticker";
import { Item } from "@/components/feed/item";
import { RightRail } from "@/components/feed/right-rail";
import { DayBreak } from "./_day-break";
import { HomeFilters, type HomeTier, type SourcePreset } from "./_home-filters";
import { getFeaturedStories } from "@/lib/items/live";
import {
  getPolicySummary,
  getPulseData,
  getRadarStats,
  getTopTopics,
} from "@/lib/shell/dashboard-stats";
import { getRecentTickerItems } from "@/lib/shell/ticker";
import { mockStories } from "@/lib/mock/stories";
import type { Story } from "@/lib/types";

export const revalidate = 60;

const SOURCE_PRESETS = new Set<SourcePreset>([
  "all",
  "official",
  "newsletter",
  "media",
  "x",
  "research",
]);

function coerceTier(v: string | undefined): HomeTier {
  return v === "p1" ? "p1" : "featured";
}
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

const FALLBACK_TICKER = [
  { lab: "OPUS 4.7", val: "score engine online", kind: "up" as const, extra: "live" },
  { lab: "AX-RADAR", val: "ingest pipeline healthy", kind: "hot" as const, extra: "ok" },
];

const DEMO_WATCHLIST = [
  { q: "gpt-6", hits: 24, delta: 8 },
  { q: "agentic IDE", hits: 17, delta: 5 },
  { q: "humanoid robot", hits: 9, delta: 2 },
  { q: "MoE-72B", hits: 14, delta: 0 },
];

export default async function HotNewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tier?: string; source?: string }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  if (sp.tier === "all") {
    const qs = new URLSearchParams();
    if (sp.source) qs.set("source", sp.source);
    const search = qs.toString();
    redirect(`/${locale}/all${search ? `?${search}` : ""}`);
  }
  setRequestLocale(locale);
  const tier = coerceTier(sp.tier);
  const sourcePreset = coerceSource(sp.source);
  const sourceFilter = presetToFilter(sourcePreset);

  let stories: Story[] = [];
  try {
    stories = await getFeaturedStories({
      tier,
      locale: locale as "zh" | "en",
      limit: 40,
      ...sourceFilter,
    });
  } catch {
    stories = [];
  }

  // Cold-start fallback: if there's literally no enriched content, show mock
  // so the shell renders something sensible.
  if (stories.length === 0 && tier === "featured" && sourcePreset === "all") {
    try {
      const probe = await getFeaturedStories({
        tier: "all",
        locale: locale as "zh" | "en",
        limit: 1,
      });
      if (probe.length === 0) stories = mockStories;
    } catch {
      stories = mockStories;
    }
  }

  const [radarStats, pulse, topics, policy, tickerItems] = await Promise.all([
    getRadarStats().catch(() => ({
      items_today: 0,
      items_p1: 0,
      items_featured: 0,
      tracked_sources: 0,
    })),
    getPulseData().catch(() => []),
    getTopTopics().catch(() => []),
    getPolicySummary().catch(() => ({ version: "v1", lastIterAt: null })),
    getRecentTickerItems(locale as "zh" | "en").catch(() => []),
  ]);
  const ticker = tickerItems.length > 0 ? tickerItems : FALLBACK_TICKER;

  const grouped = groupByDay(stories);

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{
        tracked_sources: radarStats.tracked_sources,
        signal_ratio:
          radarStats.items_today > 0
            ? (radarStats.items_p1 + radarStats.items_featured) /
              radarStats.items_today
            : 0.72,
      }}
      pulse={pulse}
      crumb="~/feed"
      cmd="tail -f signal.log"
    >
      <main className="main">
        <PageHead
          en="hot feed"
          cjk="热点资讯"
          count={stories.length}
          live={<>live · {radarStats.items_today} today</>}
          policyLabel={`policy ${policy.version}`}
        />
        <Ticker items={ticker} />
        <HomeFilters tier={tier} source={sourcePreset} />
        <div className="feed">
          {Object.entries(grouped).map(([dayKey, stories]) => (
            <div key={dayKey}>
              <DayBreak date={new Date(dayKey)} />
              {stories.map((s) => (
                <Item key={s.id} story={s} locale={locale as "en" | "zh"} />
              ))}
            </div>
          ))}
          {stories.length === 0 && (
            <div style={{ padding: 60, color: "var(--fg-3)", textAlign: "center" }}>
              no items match — try widening filters
            </div>
          )}
        </div>
      </main>
      <RightRail
        stats={radarStats}
        watchlist={DEMO_WATCHLIST}
        topics={topics}
        policyVersion={policy.version}
        lastIterAt={policy.lastIterAt ?? undefined}
      />
    </ViewShell>
  );
}

function groupByDay(stories: Story[]) {
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
