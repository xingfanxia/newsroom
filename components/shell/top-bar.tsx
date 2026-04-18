"use client";
import { useEffect, useState } from "react";

export type TopBarStats = {
  tracked_sources: number;
  signal_ratio: number;
};

/**
 * Terminal-style system bar with macOS traffic lights, breadcrumb prompt, and
 * live sysinfo (tracked sources count + signal ratio + wall clock).
 * Breadcrumb can be hidden via body[data-chrome="clean"] — handled in terminal.css.
 */
export function TopBar({
  stats,
  crumb = "~/feed",
  cmd = "tail -f signal.log",
}: {
  stats: TopBarStats;
  crumb?: string;
  cmd?: string;
}) {
  const [now, setNow] = useState<string>("");

  useEffect(() => {
    const tick = () => setNow(new Date().toTimeString().slice(0, 8));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="topbar">
      <div className="lights">
        <div className="lt c" />
        <div className="lt m" />
        <div className="lt x" />
      </div>
      <div className="crumbs">
        <span className="u">ax</span>
        <span className="d">@</span>
        <span className="h">ax-radar</span>
        <span className="d">:</span>
        <span className="p">{crumb}</span>
        <span className="d"> $ </span>
        <span style={{ color: "var(--fg-1)" }}>{cmd}</span>
      </div>
      <div className="sysinfo">
        <span>
          <span className="dot" />
          {stats.tracked_sources} src
        </span>
        <span className="hide-md">
          signal{" "}
          <b style={{ color: "var(--fg-1)" }}>
            {Math.round(stats.signal_ratio * 100)}%
          </b>
        </span>
        <span className="hide-md">cycle 04:32</span>
        <span suppressHydrationWarning>{now}</span>
      </div>
    </div>
  );
}
