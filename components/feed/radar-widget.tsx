import type { ReactNode } from "react";

export type RadarStats = {
  items_today: number;
  items_p1: number;
  items_featured: number;
  tracked_sources: number;
};

const DOTS = [
  { x: 60, y: 48, hot: true },
  { x: 42, y: 38, hot: true },
  { x: 70, y: 60, mid: true },
  { x: 50, y: 70, mid: true },
  { x: 34, y: 62 },
  { x: 78, y: 42 },
  { x: 28, y: 48 },
  { x: 60, y: 80 },
];

/**
 * Signal-radar widget — SVG with rotating sweep, concentric rings labeled by
 * HKR axes, plus a 2x2 stat grid. Sweep animation is pure CSS keyframes.
 */
export function RadarWidget({
  stats,
  moreLabel,
}: {
  stats: RadarStats;
  moreLabel?: ReactNode;
}) {
  return (
    <div className="panel">
      <div className="hd">
        <span className="t">signal radar</span>
        <span className="more">{moreLabel ?? "live"}</span>
      </div>
      <div className="radar">
        <svg viewBox="0 0 100 100">
          <circle className="radar-ring" cx="50" cy="50" r="44" fill="none" />
          <circle className="radar-ring mid" cx="50" cy="50" r="32" fill="none" />
          <circle className="radar-ring mid" cx="50" cy="50" r="20" fill="none" />
          <circle className="radar-ring" cx="50" cy="50" r="8" fill="none" />
          <line x1="50" y1="6" x2="50" y2="94" stroke="var(--border-1)" strokeWidth="0.4" />
          <line x1="6" y1="50" x2="94" y2="50" stroke="var(--border-1)" strokeWidth="0.4" />
          <text x="50" y="4" fontSize="3" fill="var(--fg-3)" textAnchor="middle">HOOK</text>
          <text x="96" y="52" fontSize="3" fill="var(--fg-3)" textAnchor="middle">RES</text>
          <text x="50" y="99" fontSize="3" fill="var(--fg-3)" textAnchor="middle">DENSITY</text>
          <text x="4" y="52" fontSize="3" fill="var(--fg-3)" textAnchor="middle">AUTH</text>
          <g className="radar-sweep" style={{ transformOrigin: "50% 50%" }}>
            <defs>
              <linearGradient id="sweepG" x1="50%" y1="50%" x2="100%" y2="50%">
                <stop offset="0%" stopColor="var(--accent-green)" stopOpacity="0.4" />
                <stop offset="100%" stopColor="var(--accent-green)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M50 50 L50 6 A44 44 0 0 1 85 26 Z" fill="url(#sweepG)" />
          </g>
          {DOTS.map((d, i) => (
            <circle
              key={i}
              cx={d.x}
              cy={d.y}
              r={d.hot ? 2 : 1.4}
              className={`radar-dot ${d.hot ? "hot" : d.mid ? "mid" : ""}`}
            />
          ))}
          <circle cx="50" cy="50" r="1.2" fill="var(--fg-0)" />
        </svg>
      </div>
      <div className="stat-grid">
        <div className="stat">
          <div className="n">
            {stats.items_today}
            <span className="sfx">items</span>
          </div>
          <div className="l">today · 24h</div>
        </div>
        <div className="stat">
          <div className="n" style={{ color: "var(--accent-orange)" }}>
            {stats.items_p1}
            <span className="sfx" style={{ color: "var(--accent-orange)" }}>
              P1
            </span>
          </div>
          <div className="l">must-read</div>
        </div>
        <div className="stat">
          <div className="n">{stats.items_featured}</div>
          <div className="l">featured</div>
        </div>
        <div className="stat">
          <div className="n">{stats.tracked_sources}</div>
          <div className="l">sources</div>
        </div>
      </div>
    </div>
  );
}
