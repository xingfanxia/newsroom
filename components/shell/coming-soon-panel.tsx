"use client";
import { useTweaks } from "@/hooks/use-tweaks";

/**
 * Terminal-styled "coming soon" placeholder — used for the routes whose
 * features we've sketched in nav but haven't implemented yet. Respects
 * tweaks.language.
 */
export function ComingSoonPanel({
  en,
  cjk,
}: {
  en: string;
  cjk: string;
}) {
  const { tweaks } = useTweaks();
  const zh = tweaks.language === "zh";
  return (
    <div
      style={{
        marginTop: 40,
        padding: "60px 40px",
        border: "1px dashed var(--border-1)",
        borderRadius: 4,
        textAlign: "center",
        color: "var(--fg-3)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--accent-green)",
          fontSize: 13,
          marginBottom: 8,
        }}
      >
        ${" "}
        <span style={{ color: "var(--fg-0)" }}>
          coming-soon {zh ? "--view" : "--view"}
        </span>
      </div>
      <div
        style={{
          fontSize: 22,
          color: "var(--fg-0)",
          fontFamily: zh ? "var(--font-sans-cjk)" : "var(--font-mono)",
          marginBottom: 6,
          letterSpacing: "-0.01em",
        }}
      >
        {zh ? cjk : en}
      </div>
      <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
        {zh
          ? "此页正在建设中，敬请期待"
          : "this view is under construction · check back soon"}
      </div>
    </div>
  );
}
