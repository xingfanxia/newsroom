import { formatTime } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Timeline layout math:
 *   - timestamp column: 80px, text right-aligned → last char sits at x=80
 *   - gap between cols: 24px (gap-6) → the rail "lane" spans x=80..104
 *   - content card starts at x=104
 *   - rail + dot anchored at x=92 (middle of the gap lane) with
 *     -translate-x-1/2, so the 10px dot spans x=87..97 — 7px clear on
 *     either side of the timestamp and the card. No overlap.
 */
export function TimelineEntry({
  date,
  children,
}: {
  date: Date;
  children: ReactNode;
}) {
  return (
    <div className="relative grid grid-cols-[80px_1fr] items-start gap-6">
      <div className="pt-4 text-right">
        <span className="font-mono text-[14px] font-[510] tabular text-[var(--color-fg)]">
          {formatTime(date)}
        </span>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute left-[92px] top-[22px] h-[10px] w-[10px] -translate-x-1/2 rounded-full border-2 border-[var(--color-cyan)] bg-[var(--color-canvas)] shadow-[0_0_0_3px_var(--color-canvas)]"
      />
      <div>{children}</div>
    </div>
  );
}

export function TimelineSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-[92px] top-12 w-px -translate-x-1/2 bg-[var(--color-rail)]"
      />
      <div className="mb-3 ml-2 px-1 text-[13px] font-[510] tabular text-[var(--color-fg-dim)]">
        {label}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
