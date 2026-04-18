/**
 * Admin KPI card — panel + header + large tabular value. Positive tone tints
 * the number green; negative tone tints it orange (matching the terminal
 * semantic for "caution" rather than the hostile red).
 */
export function MetricCard({
  label,
  value,
  note,
  tone = "default",
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: "default" | "positive" | "negative";
}) {
  const valueColor =
    tone === "positive"
      ? "var(--accent-green)"
      : tone === "negative"
        ? "var(--accent-orange)"
        : "var(--fg-0)";

  return (
    <div className="panel">
      <div className="hd">
        <span className="t">{label}</span>
      </div>
      <div className="bd">
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 36,
            fontWeight: 700,
            lineHeight: 1.05,
            color: valueColor,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
          }}
        >
          {value}
        </div>
        {note && (
          <div
            style={{
              marginTop: 10,
              fontSize: 11.5,
              lineHeight: 1.6,
              color: "var(--fg-3)",
            }}
          >
            {note}
          </div>
        )}
      </div>
    </div>
  );
}
