import { getTranslations, setRequestLocale } from "next-intl/server";
import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StoryCard } from "@/components/feed/story-card";
import {
  TimelineEntry,
  TimelineSection,
} from "@/components/feed/timeline-rail";
import { mockStories } from "@/lib/mock/stories";
import { getFeaturedStories, hasLiveStories } from "@/lib/items/live";
import { formatDateHeader } from "@/lib/utils";
import type { Story } from "@/lib/types";
import { HotNewsTabsClient } from "./_hot-news-tabs";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";

export default async function HotNewsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("hotNews");
  const tabT = await getTranslations("hotNews.tabs");

  // Graceful fallback ladder:
  //   1. Any featured stories live in DB? → show them
  //   2. DB has ANY enriched stories? → widen to `all` tier so slow news days
  //      don't silently revert to mock. This prevents mock leaking back in
  //      once enrichment has kicked off at least once.
  //   3. DB has nothing enriched yet → mock (first deploy / cold start only)
  let stories: Story[] = [];
  let live = false;
  try {
    live = await hasLiveStories();
    if (live) {
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
    }
  } catch {
    live = false;
  }
  if (!live) stories = mockStories;

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
