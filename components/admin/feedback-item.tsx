import { useTranslations } from "next-intl";
import type { FeedbackEntry } from "@/lib/types";
import { formatRelative } from "@/lib/utils";

/**
 * Single feedback row — up/down verdict as a colored dot (mirrors the
 * `.radar-dot` + `.watch-row` style), title, optional note, relative time.
 */
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

  const positive = entry.verdict === "up";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "16px 1fr auto",
        gap: 12,
        alignItems: "start",
        padding: "10px 0",
        borderBottom: "1px dashed var(--border-1)",
      }}
    >
      <span
        aria-label={positive ? "up" : "down"}
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          marginTop: 6,
          background: positive ? "var(--accent-green)" : "var(--accent-red)",
          boxShadow: positive
            ? "0 0 6px rgba(63,185,80,0.5)"
            : "0 0 6px rgba(248,81,73,0.5)",
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.45,
            color: "var(--fg-0)",
            fontWeight: 500,
            fontFamily: "var(--font-mono)",
          }}
        >
          {entry.title}
        </div>
        {entry.note && (
          <div
            style={{
              marginTop: 4,
              fontSize: 12.5,
              lineHeight: 1.55,
              color: "var(--fg-2)",
            }}
          >
            {entry.note}
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: 10.5,
          fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums",
          color: "var(--fg-3)",
          whiteSpace: "nowrap",
          paddingTop: 2,
        }}
      >
        {relLabel}
      </div>
    </div>
  );
}
