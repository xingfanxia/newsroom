/**
 * Circular score ring — shows overall importance (0-100) inside a CSS-styled
 * SVG donut. Visual variants (bar / tag / none) are controlled by the
 * body[data-score] attribute in terminal.css; the component always emits the
 * same markup.
 */
export function HkrRing({
  score,
  tier,
}: {
  score: number;
  tier: "featured" | "p1" | "all" | string;
}) {
  const r = 29;
  const C = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, score));
  const off = C - (clamped / 100) * C;
  const isP1 = tier === "p1";
  return (
    <div
      className={`hkr-ring ${isP1 ? "p1" : ""}`}
      style={{ ["--pct" as string]: clamped }}
    >
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle className="track" cx="36" cy="36" r={r} fill="none" strokeWidth="3.5" />
        <circle
          className="fill"
          cx="36"
          cy="36"
          r={r}
          fill="none"
          strokeWidth="3.5"
          strokeDasharray={C}
          strokeDashoffset={off}
          strokeLinecap="round"
        />
      </svg>
      <div className="hkr-center">
        <div className="hkr-val">{clamped}</div>
        <div className="hkr-lbl">SCORE</div>
      </div>
    </div>
  );
}
