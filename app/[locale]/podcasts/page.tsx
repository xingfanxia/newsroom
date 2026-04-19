import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { Item } from "@/components/feed/item";
import { DayBreak } from "../_day-break";
import { PodcastChannelPills } from "./_channel-pills";
import { getFeaturedStories } from "@/lib/items/live";
import { getPulseData, getRadarStats } from "@/lib/shell/dashboard-stats";
import { getPodcastChannels } from "@/lib/shell/podcast-channels";
import type { Story } from "@/lib/types";

export const revalidate = 60;

type PodTier = "featured" | "all";

export default async function PodcastsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ source?: string; tier?: string }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const activeTier: PodTier = sp.tier === "all" ? "all" : "featured";

  const [channels, stats, pulse] = await Promise.all([
    getPodcastChannels().catch(() => []),
    getRadarStats().catch(() => ({
      items_today: 0, items_p1: 0, items_featured: 0, tracked_sources: 0,
    })),
    getPulseData().catch(() => []),
  ]);

  const activeChannel =
    sp.source && channels.some((c) => c.id === sp.source) ? sp.source : null;

  // `tier='all'` surfaces excluded episodes too — lets the user catch low-
  // score YT videos (usually off-topic history/crypto stuff) that score
  // filters out of the default featured view.
  const stories = await getFeaturedStories({
    tier: activeTier,
    locale: locale as "zh" | "en",
    sourceGroup: "podcast",
    includeSourceGroup: true,
    limit: activeChannel ? 300 : 120,
  }).catch((): Story[] => []);

  const filtered = activeChannel
    ? stories.filter((s) => {
        const channel = channels.find((c) => c.id === activeChannel);
        if (!channel) return true;
        return (
          s.source.publisher === channel.nameEn ||
          s.source.publisher === channel.nameZh
        );
      })
    : stories;

  const grouped = groupByDay(filtered);
  const activeLabel = activeChannel
    ? (locale === "zh"
        ? channels.find((c) => c.id === activeChannel)?.nameZh
        : channels.find((c) => c.id === activeChannel)?.nameEn) ?? activeChannel
    : locale === "zh"
      ? "全部频道"
      : "all channels";

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{ tracked_sources: stats.tracked_sources, signal_ratio: 0.72 }}
      pulse={pulse}
      crumb={activeChannel ? `~/podcasts/${activeChannel}` : "~/podcasts"}
      cmd="ls -t podcasts/"
    >
      <main className="main">
        <PageHead
          en="podcasts"
          cjk="播客·视频"
          count={filtered.length}
          countLabel="episodes"
          extra={
            <span>
              {channels.length} {locale === "zh" ? "个频道在监控" : "channels tracked"}
            </span>
          }
        />

        <div className="filters">
          <PodcastChannelPills channels={channels} activeId={activeChannel} />
        </div>

        <TierPills
          activeTier={activeTier}
          activeChannel={activeChannel}
          locale={locale as "en" | "zh"}
        />

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
            {filtered.length}{" "}
            {locale === "zh" ? "集" : "episodes"}
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
          {filtered.length === 0 && (
            <div style={{ padding: 60, color: "var(--fg-3)", textAlign: "center" }}>
              {locale === "zh"
                ? "暂无剧集"
                : "no episodes yet — check back soon"}
            </div>
          )}
        </div>
      </main>
    </ViewShell>
  );
}

function TierPills({
  activeTier,
  activeChannel,
  locale,
}: {
  activeTier: PodTier;
  activeChannel: string | null;
  locale: "en" | "zh";
}) {
  const zh = locale === "zh";
  const build = (tier: PodTier) => {
    const qs = new URLSearchParams();
    if (activeChannel) qs.set("source", activeChannel);
    if (tier === "all") qs.set("tier", "all");
    const s = qs.toString();
    return `/${locale}/podcasts${s ? `?${s}` : ""}`;
  };
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        margin: "8px 0 10px",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: 10,
          color: "var(--fg-3)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginRight: 4,
        }}
      >
        {zh ? "筛选" : "tier"}
      </span>
      <a
        href={build("featured")}
        className="day-pill"
        data-active={activeTier === "featured" ? "true" : "false"}
      >
        <span className="d">{zh ? "精选" : "featured"}</span>
      </a>
      <a
        href={build("all")}
        className="day-pill"
        data-active={activeTier === "all" ? "true" : "false"}
      >
        <span className="d">{zh ? "全部" : "all"}</span>
      </a>
      <span
        style={{
          marginLeft: 8,
          fontSize: 10,
          color: "var(--fg-4)",
          fontStyle: "italic",
        }}
      >
        {zh
          ? activeTier === "all"
            ? "含低分剧集"
            : "仅精选"
          : activeTier === "all"
            ? "includes low-score"
            : "curated only"}
      </span>
    </div>
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
