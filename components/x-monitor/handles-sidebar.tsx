"use client";
import Link from "next/link";
import { useTweaks } from "@/hooks/use-tweaks";

export type XHandleEntry = {
  id: string;
  handle: string;
  nameEn: string;
  nameZh: string;
  last24h: number;
  total: number;
};

/**
 * X Monitor left sidebar — lists tracked handles with 24h post counts.
 * A ?handle=<sourceId> query param surfaces a per-handle firehose.
 */
export function XHandlesSidebar({
  locale,
  handles,
  activeHandle,
}: {
  locale: "en" | "zh";
  handles: XHandleEntry[];
  activeHandle: string | null;
}) {
  const { tweaks } = useTweaks();
  const zh = tweaks.language === "zh";
  const total = handles.reduce((a, b) => a + b.last24h, 0);
  return (
    <aside className="coll-list" style={{ fontFamily: "var(--font-mono)" }}>
      <div className="sec" style={{ padding: 0, marginBottom: 6 }}>
        <span>{zh ? "监控账号" : "tracked handles"}</span>
        <span className="sec-c">{handles.length}</span>
      </div>

      <Link
        href={`/${locale}/x-monitor`}
        className="watch-row"
        style={{
          padding: "6px 6px",
          background: !activeHandle ? "var(--tint-white-03)" : "transparent",
          borderLeft: !activeHandle ? "2px solid var(--accent-green)" : "2px solid transparent",
          paddingLeft: !activeHandle ? 4 : 6,
          borderBottom: "1px dashed var(--border-1)",
          textDecoration: "none",
        }}
      >
        <span className="sym">▸</span>
        <span className="q" style={{ color: !activeHandle ? "var(--fg-0)" : "var(--fg-1)" }}>
          {zh ? "全部" : "all handles"}
        </span>
        <span className="hits" style={{ color: "var(--fg-3)" }}>
          {total}
        </span>
        <span />
      </Link>

      {handles.map((h) => {
        const active = activeHandle === h.id;
        const label = zh ? h.nameZh : h.nameEn;
        return (
          <Link
            key={h.id}
            href={`/${locale}/x-monitor?handle=${encodeURIComponent(h.id)}`}
            className="watch-row"
            style={{
              padding: "6px 6px",
              background: active ? "var(--tint-white-03)" : "transparent",
              borderLeft: active
                ? "2px solid var(--accent-green)"
                : "2px solid transparent",
              paddingLeft: active ? 4 : 6,
              borderBottom: "1px dashed var(--border-1)",
              textDecoration: "none",
            }}
          >
            <span className="sym">@</span>
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
              <span
                style={{
                  color: active ? "var(--fg-0)" : "var(--fg-1)",
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {h.handle}
              </span>
              <span
                style={{
                  fontSize: 9.5,
                  color: "var(--fg-3)",
                  fontFamily: zh ? "var(--font-sans-cjk)" : "var(--font-mono)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
            </div>
            <span
              className="hits"
              style={{
                color: h.last24h > 0 ? "var(--accent-green)" : "var(--fg-3)",
              }}
            >
              {h.last24h > 0 ? `+${h.last24h}` : "—"}
            </span>
            <span />
          </Link>
        );
      })}

      <div
        style={{
          marginTop: 14,
          paddingTop: 10,
          borderTop: "1px dashed var(--border-1)",
          fontSize: 10.5,
          color: "var(--fg-3)",
          letterSpacing: "0.02em",
        }}
      >
        {zh
          ? "按小时定期拉取，原创内容（排除转推/回复）"
          : "polled hourly · original posts only (no RT/replies)"}
      </div>
    </aside>
  );
}
