import { useLocale, useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { Story } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { TagChip } from "./tag-chip";
import { ScoreBadge } from "./score-badge";
import { FeedbackControls } from "./feedback-controls";
import { CrossSourceIndicator } from "./cross-source-indicator";

/**
 * Translate a canonical tag ID through the i18n dict. Entity names
 * (OpenAI / Anthropic / ByteDance) aren't in the dict; getMessageFallback
 * in i18n/request.ts returns the raw key silently.
 */
function translateTag(
  t: ReturnType<typeof useTranslations>,
  tag: string,
): string {
  return t(`all.${tag}`);
}

export function StoryCard({ story }: { story: Story }) {
  const t = useTranslations("story");
  const tSource = useTranslations("sources");
  const tTag = useTranslations("tags");
  const locale = useLocale();
  const kindLabel = tSource(`kindFilter.${story.source.kindCode}`);
  const localeLabel = tSource(`localeFilter.${story.source.localeCode}`);

  return (
    <article className="surface-card relative group p-5 transition-colors hover:bg-white/[0.04]">
      {/* Header row: source meta + featured pill */}
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] text-[var(--color-fg-dim)] min-w-0">
          <span className="font-[510] text-[var(--color-fg-muted)]">
            {story.source.publisher}
          </span>
          <span className="text-[var(--color-fg-faint)]">·</span>
          <span className="truncate">
            {kindLabel} · {localeLabel}
          </span>
          {story.featured && (
            <Badge variant="cyan" size="sm" className="ml-1">
              {t("featured")}
            </Badge>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {story.hkr && <HKRBadges hkr={story.hkr} t={t} locale={locale} />}
          <ScoreBadge score={story.importance} />
          <FeedbackControls storyId={story.id} />
        </div>
      </div>

      {/* Title */}
      <h3 className="text-[17px] font-[590] tracking-[-0.2px] leading-snug text-[var(--color-fg)]">
        <a
          href={story.url}
          target="_blank"
          rel="noreferrer"
          className="hover:text-[var(--color-cyan-hover)] transition-colors"
        >
          {story.title}
        </a>
      </h3>

      {/* Summary */}
      <p className="mt-2 text-[14.5px] leading-[1.65] text-[var(--color-fg-muted)]">
        {story.summary}
      </p>

      {/* Featured reason — LLM's justification for the tier/importance,
          populated by the scoring stage. Shows on every featured item so the
          reader can judge the pick instead of trusting the score blindly. */}
      {story.featured && story.reasoning && (
        <div className="mt-3 border-l-2 border-[var(--color-warning)]/50 bg-[rgba(245,158,11,0.04)] px-3 py-2">
          <div className="mb-0.5 text-[11px] uppercase tracking-[0.14em] text-[var(--color-warning)]/90">
            {t("featuredReason")}
          </div>
          <p className="text-[13.5px] leading-[1.6] text-[var(--color-fg)]">
            {story.reasoning}
          </p>
        </div>
      )}

      {/* Editor note — short executive commentary for featured+p1 items */}
      {story.editorNote && (
        <div className="mt-3 border-l-2 border-[var(--color-cyan)]/50 bg-[rgba(62,230,230,0.04)] px-3 py-2">
          <div className="mb-0.5 text-[11px] uppercase tracking-[0.14em] text-[var(--color-cyan)]/80">
            {t("editorNote")}
          </div>
          <p className="text-[13.5px] leading-[1.6] text-[var(--color-fg)]">
            {story.editorNote}
          </p>
        </div>
      )}

      {/* Tags — translated via i18n tags dict, raw fallback for entities */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {story.tags.map((tag) => (
          <TagChip key={tag}>{translateTag(tTag, tag)}</TagChip>
        ))}
      </div>

      {/* Deep-take link — only for podcasts, where the full editor_analysis
          and the captioned transcript make a dedicated page worth the click. */}
      {story.source.groupCode === "podcast" ? (
        <Link
          href={`/podcasts/${story.id}` as "/"}
          className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-[510] text-[var(--color-cyan)]/90 transition-colors hover:text-[var(--color-cyan)]"
        >
          {t("podcastDeepTake")}
          <ArrowRight size={12} />
        </Link>
      ) : null}

      {story.crossSourceCount ? (
        <CrossSourceIndicator count={story.crossSourceCount} />
      ) : null}
    </article>
  );
}

/**
 * HKR rubric chips. Each axis (H = Happy / K = Knowledge / R = Resonance)
 * shows as either a solid cyan pill (axis hit) or a dim outline pill (miss).
 * Tooltip shows the per-axis rationale from the scorer (reasonsZh/En), so
 * a reader can see not just WHETHER the axis hit but WHY it did or didn't.
 * Falls back to the generic axis label for older rows that don't have
 * reasons populated yet.
 */
function HKRBadges({
  hkr,
  t,
  locale,
}: {
  hkr: NonNullable<Story["hkr"]>;
  t: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  const reasons =
    locale === "en" ? hkr.reasonsEn ?? hkr.reasonsZh : hkr.reasonsZh ?? hkr.reasonsEn;
  const axes: Array<{ key: "h" | "k" | "r"; pass: boolean }> = [
    { key: "h", pass: hkr.h },
    { key: "k", pass: hkr.k },
    { key: "r", pass: hkr.r },
  ];
  return (
    <div
      className="flex items-center gap-[3px]"
      aria-label={`HKR ${hkr.h ? "H" : "-"}${hkr.k ? "K" : "-"}${hkr.r ? "R" : "-"}`}
    >
      {axes.map((a) => {
        const axisLabel = t(`hkr.${a.key}`);
        const reason = reasons?.[a.key];
        const title = reason ? `${axisLabel} — ${reason}` : axisLabel;
        return (
          <span
            key={a.key}
            title={title}
            className={
              a.pass
                ? "inline-flex h-4 min-w-4 items-center justify-center rounded-sm px-1 text-[10px] font-[590] leading-none bg-[rgba(62,230,230,0.18)] text-[var(--color-cyan)] shadow-[inset_0_0_0_1px_rgba(62,230,230,0.35)]"
                : "inline-flex h-4 min-w-4 items-center justify-center rounded-sm px-1 text-[10px] font-[510] leading-none text-[var(--color-fg-faint)] border border-[var(--color-border-subtle)]"
            }
          >
            {a.key.toUpperCase()}
          </span>
        );
      })}
    </div>
  );
}
