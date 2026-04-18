import { getTranslations, setRequestLocale } from "next-intl/server";
import { StoryCard } from "@/components/feed/story-card";
import {
  TimelineEntry,
  TimelineSection,
} from "@/components/feed/timeline-rail";
import { getFeaturedStories } from "@/lib/items/live";
import { formatDateHeader } from "@/lib/utils";
import type { Story } from "@/lib/types";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";

// Share the home page's 60s revalidate — tweets flow through the same
// ingest → normalize → enrich pipeline.
export const revalidate = 60;

export default async function XMonitorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("xMonitor");

  // `tier: "all"` because we want every original tweet the scorer rated non-
  // excluded, not just the ones that hit featured. This is a surveillance
  // view, not a curated top list.
  let stories: Story[] = [];
  try {
    stories = await getFeaturedStories({
      tier: "all",
      locale: locale as "zh" | "en",
      sourceKind: "x-api",
      limit: 60,
    });
  } catch {
    stories = [];
  }

  const grouped = groupByDay(stories);

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-[var(--color-border-subtle)] bg-[var(--color-canvas)]/80 backdrop-blur-md">
        <div className="px-8 pt-6 pb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[28px] font-[590] tracking-[-0.56px] leading-tight text-[var(--color-fg)]">
              {t("title")}
            </h1>
            <p className="mt-1 text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
              {t("subtitle", { count: stories.length })}
            </p>
          </div>
          <LocaleSwitcher />
        </div>
      </header>

      <div className="px-8 py-10">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-12">
          {stories.length === 0 ? (
            <p className="py-16 text-center text-[14px] text-[var(--color-fg-dim)]">
              {t("empty")}
            </p>
          ) : (
            Object.entries(grouped).map(([dayKey, list]) => {
              const day = new Date(dayKey);
              return (
                <TimelineSection
                  key={dayKey}
                  label={formatDateHeader(day, locale as "zh" | "en")}
                >
                  {list.map((s) => (
                    <TimelineEntry key={s.id} date={new Date(s.publishedAt)}>
                      <StoryCard story={s} />
                    </TimelineEntry>
                  ))}
                </TimelineSection>
              );
            })
          )}
        </div>
      </div>
    </>
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
