import { getTranslations, setRequestLocale } from "next-intl/server";
import { Search, Rss } from "lucide-react";
import { Input } from "@/components/ui/input";
import { StoryCard } from "@/components/feed/story-card";
import {
  TimelineEntry,
  TimelineSection,
} from "@/components/feed/timeline-rail";
import { getFeaturedStories } from "@/lib/items/live";
import { formatDateHeader } from "@/lib/utils";
import type { Story } from "@/lib/types";
import {
  SourceFilterClient,
  type SourcePreset,
} from "../_source-filter";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";

// Same revalidation as Hot News — both views read from the same enriched pool
// and the enrich cron runs every 15 min.
export const revalidate = 60;

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
    case "official":
      return { sourceGroup: "vendor-official" };
    case "newsletter":
      return { sourceGroup: "newsletter" };
    case "media":
      return { sourceGroup: "media" };
    case "research":
      return { sourceGroup: "research" };
    case "x":
      return { sourceKind: "x-api" };
    case "all":
    default:
      return {};
  }
}

export default async function AllPostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations("allPosts");
  const srcT = await getTranslations("hotNews.sourceFilter");
  const searchT = await getTranslations("hotNews");
  const sourcePreset = coerceSource(sp.source);
  const sourceFilter = presetToFilter(sourcePreset);

  let stories: Story[] = [];
  try {
    stories = await getFeaturedStories({
      tier: "all",
      locale: locale as "zh" | "en",
      limit: 80,
      ...sourceFilter,
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
              <h1 className="text-[28px] font-[590] tracking-[-0.56px] leading-tight text-[var(--color-fg)]">
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

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div
              className="relative flex-1 max-w-[680px] opacity-40 pointer-events-none"
              title="Coming soon"
            >
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-dim)]"
              />
              <Input
                placeholder={searchT("search")}
                className="h-10 pl-9"
                aria-label={searchT("search")}
                disabled
              />
            </div>
            <SourceFilterClient
              value={sourcePreset}
              labels={{
                all: srcT("all"),
                official: srcT("official"),
                newsletter: srcT("newsletter"),
                media: srcT("media"),
                x: srcT("x"),
                research: srcT("research"),
              }}
            />
          </div>
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
