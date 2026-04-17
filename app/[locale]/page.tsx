import { getTranslations, setRequestLocale } from "next-intl/server";
import { Search, SlidersHorizontal, Rss } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StoryCard } from "@/components/feed/story-card";
import {
  TimelineEntry,
  TimelineSection,
} from "@/components/feed/timeline-rail";
import { mockStories } from "@/lib/mock/stories";
import { getFeaturedStories } from "@/lib/items/live";
import { formatDateHeader } from "@/lib/utils";
import type { Story } from "@/lib/types";
import { HotNewsTabsClient } from "./_hot-news-tabs";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";

// ISR: serve from CDN cache, regenerate at most once per minute. Enrich cron
// runs every 15 min so 60s staleness is imperceptible and drops DB roundtrips
// on the home page by ~99%.
export const revalidate = 60;

export default async function HotNewsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("hotNews");
  const tabT = await getTranslations("hotNews.tabs");

  // Single-query fallback ladder: try featured+p1, widen to `all` if empty,
  // fall back to mock only when DB has nothing. Drops the separate
  // hasLiveStories probe that was adding a cross-region roundtrip.
  let stories: Story[] = [];
  try {
    stories = await getFeaturedStories({
      tier: "featured",
      locale: locale as "zh" | "en",
      limit: 40,
    });
    if (stories.length === 0) {
      stories = await getFeaturedStories({
        tier: "all",
        locale: locale as "zh" | "en",
        limit: 40,
      });
    }
  } catch {
    stories = [];
  }
  if (stories.length === 0) stories = mockStories;

  const grouped = groupByDay(stories);

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-[var(--color-border-subtle)] bg-[var(--color-canvas)]/80 backdrop-blur-md">
        <div className="px-8 pt-6 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[28px] font-[590] tracking-[-0.56px] leading-tight text-[var(--color-fg)]">
                {t("title")}
              </h1>
              <p className="mt-1 text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
                {t("subtitle", { count: stories.length })}
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <HotNewsTabsClient
                labels={{
                  featured: tabT("featured"),
                  all: tabT("all"),
                  p1: tabT("p1"),
                }}
              />
              <a
                href={`/api/feed/${locale}/rss.xml`}
                title="Subscribe via RSS"
                aria-label="RSS feed"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-fg-dim)] transition-all hover:bg-white/[0.04] hover:text-[var(--color-cyan)]"
                target="_blank"
                rel="noreferrer"
              >
                <Rss size={14} />
              </a>
              <LocaleSwitcher />
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <div className="relative flex-1 max-w-[680px]">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-dim)]"
              />
              <Input
                placeholder={t("search")}
                className="h-10 pl-9"
                aria-label={t("search")}
              />
            </div>
            <Button variant="primary" size="md">
              <SlidersHorizontal size={14} />
              <span>{t("filter")}</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="px-8 py-10">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-12">
          {Object.entries(grouped).map(([dayKey, stories]) => {
            const day = new Date(dayKey);
            return (
              <TimelineSection
                key={dayKey}
                label={formatDateHeader(day, locale as "zh" | "en")}
              >
                {stories.map((s) => (
                  <TimelineEntry key={s.id} date={new Date(s.publishedAt)}>
                    <StoryCard story={s} />
                  </TimelineEntry>
                ))}
              </TimelineSection>
            );
          })}
        </div>
      </div>
    </>
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
