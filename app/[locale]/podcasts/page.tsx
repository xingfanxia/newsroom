import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { Item } from "@/components/feed/item";
import { FeedEmptyState } from "@/components/feed/empty-state";
import { DayBreak } from "../_day-break";
import { FeedArchivePagination } from "@/components/feed/archive-pagination";
import {
  coerceFeedOffset,
  FEED_PAGE_SIZE,
} from "@/lib/feed/page-query";
import { groupByDay, sortStoriesNewestFirst } from "@/lib/feed/group-by-day";
import {
  coercePodcastTier,
  DEFAULT_PODCAST_TIER,
  PODCAST_TIERS,
  type PodcastTier,
} from "@/lib/feed/podcast-filters";
import { PodcastChannelPills } from "./_channel-pills";
import { readPodcastsPageModel } from "@/lib/public-content/page-models";
import { appLocaleFromParam, type AppLocale } from "@/lib/types";

export const revalidate = 60;

const PODCAST_TIER_LABELS = {
  featured: { en: "featured", zh: "精选" },
  all: { en: "all", zh: "全部" },
} as const satisfies Record<PodcastTier, { en: string; zh: string }>;

const PODCAST_TIER_NOTES = {
  featured: { en: "curated only", zh: "仅精选" },
  all: { en: "includes low-score", zh: "含低分剧集" },
} as const satisfies Record<PodcastTier, { en: string; zh: string }>;

export default async function PodcastsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ source?: string; tier?: string; offset?: string }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  const appLocale = appLocaleFromParam(locale);
  setRequestLocale(appLocale);
  const activeTier: PodcastTier = coercePodcastTier(sp.tier);
  const offset = coerceFeedOffset(sp.offset);

  const {
    channels,
    activeChannel,
    stories: filtered,
    chrome,
  } = await readPodcastsPageModel({
    locale: appLocale,
    source: sp.source,
    tier: activeTier,
    offset,
  });

  const grouped = groupByDay(sortStoriesNewestFirst(filtered));
  const activeLabel = activeChannel
    ? (appLocale === "zh"
        ? channels.find((c) => c.id === activeChannel)?.nameZh
        : channels.find((c) => c.id === activeChannel)?.nameEn) ?? activeChannel
    : appLocale === "zh"
      ? "全部频道"
      : "all channels";

  return (
    <ViewShell
      locale={appLocale}
      stats={chrome.topBarStats}
      pulse={chrome.pulse}
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
              {channels.length} {appLocale === "zh" ? "个频道在监控" : "channels tracked"}
            </span>
          }
        />

        <div className="filters">
          <PodcastChannelPills channels={channels} activeId={activeChannel} />
        </div>

        <TierPills
          activeTier={activeTier}
          activeChannel={activeChannel}
          locale={appLocale}
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
            {appLocale === "zh" ? "集" : "episodes"}
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
          {filtered.length === 0 && (
            <FeedEmptyState>
              {appLocale === "zh"
                ? "暂无剧集"
                : "no episodes yet — check back soon"}
            </FeedEmptyState>
          )}
        </div>
        {filtered.length > 0 && (
          <FeedArchivePagination
            basePath={`/${appLocale}/podcasts`}
            offset={offset}
            pageSize={FEED_PAGE_SIZE}
            currentCount={filtered.length}
            locale={appLocale}
            preservedParams={{
              source: activeChannel,
              tier:
                activeTier === DEFAULT_PODCAST_TIER ? undefined : activeTier,
            }}
          />
        )}
      </main>
    </ViewShell>
  );
}

function TierPills({
  activeTier,
  activeChannel,
  locale,
}: {
  activeTier: PodcastTier;
  activeChannel: string | null;
  locale: AppLocale;
}) {
  const zh = locale === "zh";
  const build = (tier: PodcastTier) => {
    const qs = new URLSearchParams();
    if (activeChannel) qs.set("source", activeChannel);
    if (tier !== DEFAULT_PODCAST_TIER) qs.set("tier", tier);
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
      {PODCAST_TIERS.map((tier) => {
        const label = PODCAST_TIER_LABELS[tier];
        return (
          <a
            key={tier}
            href={build(tier)}
            className="day-pill"
            data-active={activeTier === tier ? "true" : "false"}
          >
            <span className="d">{zh ? label.zh : label.en}</span>
          </a>
        );
      })}
      <span
        style={{
          marginLeft: 8,
          fontSize: 10,
          color: "var(--fg-4)",
          fontStyle: "italic",
        }}
      >
        {zh
          ? PODCAST_TIER_NOTES[activeTier].zh
          : PODCAST_TIER_NOTES[activeTier].en}
      </span>
    </div>
  );
}
