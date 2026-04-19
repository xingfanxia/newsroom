"use client";
import { useTweaks } from "@/hooks/use-tweaks";

export type TickerItem = {
  lab: string;
  val: string;
  kind?: "up" | "down" | "hot";
  extra?: string;
};

/**
 * Top-of-page auto-scrolling strip. Animation lives in terminal.css;
 * duplicated data inline so the CSS keyframe loop is seamless.
 */
export function Ticker({ items }: { items: TickerItem[] }) {
  const { tweaks } = useTweaks();
  if (!tweaks.showTicker) return null;
  const doubled = [...items, ...items, ...items];
  return (
    <div className="ticker-wrap">
      <div className="ticker">
        {doubled.map((t, i) => (
          <span key={`${t.lab}-${i}`} className="tk">
            <span className="lab">{t.lab}</span>
            <span className="val">{t.val}</span>
            {t.extra && (
              <span
                className={t.kind === "up" ? "up" : t.kind === "down" ? "dn" : "hot"}
              >
                {t.extra}
              </span>
            )}
            <span style={{ color: "var(--border-2)" }}>·</span>
          </span>
        ))}
      </div>
    </div>
  );
}
