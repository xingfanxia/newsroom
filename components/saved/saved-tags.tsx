"use client";
import { useTweaks } from "@/hooks/use-tweaks";

/**
 * Tag cloud surfaced below the collections sidebar — top tags from the
 * currently-selected collection's items. Server renders `tags`, this
 * component just handles localization of the label.
 */
export function SavedTags({ tags }: { tags: Array<{ tag: string; count: number }> }) {
  const { tweaks } = useTweaks();
  const zh = tweaks.language === "zh";
  if (tags.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 14,
        paddingTop: 10,
        borderTop: "1px dashed var(--border-1)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--fg-3)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 6,
          fontFamily: "var(--font-mono)",
        }}
      >
        {zh ? "标签" : "tags"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {tags.map((t) => (
          <span
            key={t.tag}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: "var(--fg-2)",
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              padding: "1px 5px",
              border: "1px solid var(--border-1)",
              borderRadius: 2,
              background: "var(--bg-2)",
            }}
          >
            <span style={{ color: "var(--accent-blue)" }}>#</span>
            {t.tag}
            <span style={{ color: "var(--fg-3)", fontSize: 9 }}>{t.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
