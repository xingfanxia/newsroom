import { ThumbsUp, ThumbsDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FeedbackEntry } from "@/lib/types";
import { formatRelative } from "@/lib/utils";

export function FeedbackItem({
  entry,
  locale,
}: {
  entry: FeedbackEntry;
  locale: "zh" | "en";
}) {
  const t = useTranslations("common.relativeTime");
  const rel = formatRelative(new Date(entry.createdAt), locale);
  const relLabel =
    rel.kind === "justNow"
      ? t("justNow")
      : rel.kind === "minutes"
        ? t("minutesAgo", { count: rel.value! })
        : rel.kind === "hours"
          ? t("hoursAgo", { count: rel.value! })
          : t("daysAgo", { count: rel.value! });

  return (
    <div className="flex gap-4 py-3 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <div className="pt-0.5">
        {entry.verdict === "up" ? (
          <ThumbsUp size={16} className="text-[var(--color-positive)]" />
        ) : (
          <ThumbsDown size={16} className="text-[var(--color-negative)]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] font-[510] text-[var(--color-fg)] leading-snug">
          {entry.title}
        </div>
        {entry.note ? (
          <div className="mt-1 text-[13px] text-[var(--color-fg-dim)] leading-relaxed">
            {entry.note}
          </div>
        ) : null}
      </div>
      <div className="shrink-0 pt-0.5 text-[12px] font-mono tabular text-[var(--color-fg-dim)]">
        {relLabel}
      </div>
    </div>
  );
}
