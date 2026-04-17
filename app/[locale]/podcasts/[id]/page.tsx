import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getItemDetail } from "@/lib/items/detail";
import { Prose } from "@/components/markdown/prose";
import { Transcript } from "@/components/podcasts/transcript";
import { YouTubeEmbed, extractYouTubeId } from "@/components/podcasts/youtube-embed";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { Badge } from "@/components/ui/badge";
import { formatDateHeader } from "@/lib/utils";

// Re-render every 5 min — commentary + transcript only change via background
// jobs, so there's no need to hit the DB on every navigation.
export const revalidate = 300;

export default async function PodcastDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id: idRaw } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("podcasts.detail");

  const id = Number.parseInt(idRaw, 10);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const detail = await getItemDetail(id, locale === "en" ? "en" : "zh");
  if (!detail) notFound();

  const { story, bodyMd } = detail;
  const publishedDate = formatDateHeader(
    new Date(story.publishedAt),
    locale as "zh" | "en",
  );
  const isYouTube = extractYouTubeId(story.url) !== null;

  return (
    <>
      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-canvas)]/80 px-8 py-3.5 backdrop-blur-md">
        <Link
          href={"/podcasts" as const}
          className="inline-flex items-center gap-2 text-[13.5px] font-[510] text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)]"
        >
          <ArrowLeft size={14} />
          {t("backToList")}
        </Link>
        <LocaleSwitcher />
      </header>

      <article className="mx-auto max-w-[860px] px-8 py-10">
        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-fg-dim)]">
          <span className="font-[510] text-[var(--color-fg-muted)]">
            {story.source.publisher}
          </span>
          <span className="text-[var(--color-fg-faint)]">·</span>
          <span>{publishedDate}</span>
          {story.featured ? (
            <Badge variant="cyan" size="sm" className="ml-1">
              {t("featured")}
            </Badge>
          ) : null}
        </div>

        {/* Title */}
        <h1 className="mt-3 text-[30px] font-[590] tracking-[-0.6px] leading-[1.2] text-[var(--color-fg)]">
          {story.title}
        </h1>

        {/* Summary */}
        {story.summary ? (
          <p className="mt-4 text-[16px] leading-[1.7] text-[var(--color-fg-muted)]">
            {story.summary}
          </p>
        ) : null}

        {/* Source link + YouTube embed */}
        <div className="mt-6 flex flex-col gap-4">
          {isYouTube ? (
            <YouTubeEmbed url={story.url} title={story.title} />
          ) : null}
          <a
            href={story.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-[13px] text-[var(--color-cyan)] underline decoration-[var(--color-cyan)]/40 underline-offset-4 transition-colors hover:decoration-[var(--color-cyan)]"
          >
            {t("listenAtSource")}
            <ExternalLink size={12} />
          </a>
        </div>

        {/* Editor's take — short + long */}
        {story.editorNote ? (
          <section className="mt-10 rounded-xl border-l-2 border-[var(--color-cyan)]/50 bg-[rgba(62,230,230,0.04)] px-5 py-4">
            <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-[var(--color-cyan)]/80">
              {t("editorTake")}
            </div>
            <p className="text-[15px] leading-[1.65] text-[var(--color-fg)]">
              {story.editorNote}
            </p>
          </section>
        ) : null}

        {story.editorAnalysis ? (
          <section className="mt-8">
            <h2 className="mb-1 text-[11px] uppercase tracking-[0.14em] text-[var(--color-cyan)]/80">
              {t("deepTake")}
            </h2>
            <div className="border-t border-[var(--color-border-subtle)] pt-3">
              <Prose>{story.editorAnalysis}</Prose>
            </div>
          </section>
        ) : null}

        {/* Transcript */}
        <section className="mt-10">
          <Transcript bodyMd={bodyMd} />
        </section>
      </article>
    </>
  );
}
