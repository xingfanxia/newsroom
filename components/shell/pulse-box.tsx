import { useTweaks } from "@/hooks/use-tweaks";

export type PulsePoint = { h: number; c: number };

/**
 * Compact 24-hour bar chart rendered in the left rail. Peak hour label
 * localizes with tweaks.language.
 */
export function PulseBox({ data }: { data: PulsePoint[] }) {
  const { tweaks } = useTweaks();
  const max = Math.max(1, ...data.map((d) => d.c));
  const peakHour = data.reduce((a, b) => (b.c > a.c ? b : a), data[0] ?? { h: 0, c: 0 });
  const title = tweaks.language === "zh" ? "信号脉冲 · 24h" : "signal pulse · 24h";
  const peakLbl =
    tweaks.language === "zh"
      ? `峰值 ${String(peakHour.h).padStart(2, "0")}:00`
      : `peak ${String(peakHour.h).padStart(2, "0")}:00`;
  return (
    <div className="pulse-box">
      <div className="pulse-hd">
        <span>{title}</span>
        <span className="peak">{peakLbl}</span>
      </div>
      <div className="pulse-bars">
        {data.map((d) => {
          const pct = Math.max(2, (d.c / max) * 46);
          const cls = d.c >= max * 0.7 ? "hi" : d.c >= max * 0.4 ? "mid" : "";
          return (
            <div
              key={d.h}
              className={`pulse-bar ${cls}`}
              style={{ height: `${pct}px` }}
              title={`${d.h}:00 · ${d.c}`}
            />
          );
        })}
      </div>
      <div className="pulse-labels">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
}
