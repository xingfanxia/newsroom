import { useTranslations } from "next-intl";
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
          <ScoreBadge score={story.importance} />
          <FeedbackControls />
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

      {story.crossSourceCount ? (
        <CrossSourceIndicator count={story.crossSourceCount} />
      ) : null}
    </article>
  );
}
