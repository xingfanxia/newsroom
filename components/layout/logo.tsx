import { cn } from "@/lib/utils";

/**
 * Radar wordmark: "AX" + radar-sweep glyph + "RADAR".
 * The sweep is a CSS-animated conic-gradient (respects prefers-reduced-motion
 * via .radar-sweep class in globals.css). Grid rings + center pin are static.
 */
export function Logo({
  size = 48,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "surface-card relative flex items-center justify-center gap-1.5 px-3 py-2 min-w-[128px]",
        "bg-[rgba(62,230,230,0.02)] border-[rgba(62,230,230,0.08)]",
        className,
      )}
      style={{ height: size }}
      aria-label="AX's AI RADAR"
    >
      <span className="font-[590] tracking-tight text-[var(--color-fg)] text-[15px]">
        AX
      </span>
      <RadarGlyph />
      <span className="font-[590] tracking-tight text-[var(--color-cyan)] text-[15px]">
        RADAR
      </span>
    </div>
  );
}

function RadarGlyph() {
  return (
    <span
      aria-hidden
      className="relative inline-block h-4 w-4"
    >
      {/* outer ring */}
      <span className="absolute inset-0 rounded-full border border-[var(--color-cyan)]/40" />
      {/* mid ring */}
      <span className="absolute inset-[3px] rounded-full border border-[var(--color-cyan)]/25" />
      {/* sweep */}
      <span className="radar-sweep absolute inset-0 rounded-full" />
      {/* blip */}
      <span className="radar-blip absolute left-[11px] top-[3px] h-[3px] w-[3px] rounded-full bg-[var(--color-cyan)] shadow-[0_0_6px_rgba(62,230,230,0.9)]" />
      {/* center pin */}
      <span className="absolute left-1/2 top-1/2 h-[2px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-cyan)]" />
    </span>
  );
}
