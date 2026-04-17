import { getTranslations, setRequestLocale } from "next-intl/server";
import { Headphones, Rss } from "lucide-react";
import { StoryCard } from "@/components/feed/story-card";
import {
  TimelineEntry,
  TimelineSection,
} from "@/components/feed/timeline-rail";
import { getFeaturedStories } from "@/lib/items/live";
import { formatDateHeader } from "@/lib/utils";
import type { Story } from "@/lib/types";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";

// ISR: same 60s cadence as the home page. Podcasts get ~1 new item per day
// across all channels combined, so 60s staleness is invisible.
export const revalidate = 60;

export default async function PodcastsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("podcasts");

  // Show everything in the "podcast" source-group, not just featured-tier.
  // These are long-form (1-3 hr) interviews — much rarer than articles, so
  // tiering is less useful; the reader wants to see them all.
  let stories: Story[] = [];
  try {
    stories = await getFeaturedStories({
      tier: "all",
      locale: locale as "zh" | "en",
      sourceGroup: "podcast",
      includeSourceGroup: true,
      limit: 60,
    });
  } catch {
    stories = [];
  }

  const grouped = groupByDay(stories);

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-[var(--color-border-subtle)] bg-[var(--color-canvas)]/80 backdrop-blur-md">
        <div className="px-8 pt-6 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-[28px] font-[590] tracking-[-0.56px] leading-tight text-[var(--color-fg)]">
                <Headphones size={22} className="text-[var(--color-cyan)]" />
                {t("title")}
              </h1>
              <p className="mt-1 text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
                {t("subtitle", { count: stories.length })}
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
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
        </div>
      </header>

      <div className="px-8 py-10">
        {stories.length === 0 ? (
          <div className="mx-auto max-w-[680px] py-24 text-center">
            <Headphones
              size={40}
              className="mx-auto mb-4 text-[var(--color-fg-faint)]"
            />
            <p className="text-[15px] text-[var(--color-fg-muted)]">
              {t("empty")}
            </p>
          </div>
        ) : (
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
        )}
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
