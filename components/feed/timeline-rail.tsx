import { formatTime } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Timeline entry layout. The rail lives in the parent <TimelineSection> at
 * left=80px (centered using translateX(-50%)). Each entry places its dot at
 * the same left=80px reference so the dot and rail share a single x-axis —
 * avoids subpixel drift from computing two independent left offsets.
 */
export function TimelineEntry({
  date,
  children,
}: {
  date: Date;
  children: ReactNode;
}) {
  return (
    <div className="relative grid grid-cols-[80px_1fr] items-start gap-4">
      <div className="pt-4 text-right">
        <span className="font-mono text-[14px] font-[510] tabular text-[var(--color-fg)]">
          {formatTime(date)}
        </span>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute left-[80px] top-[22px] h-[10px] w-[10px] -translate-x-1/2 rounded-full border-2 border-[var(--color-cyan)] bg-[var(--color-canvas)] shadow-[0_0_0_3px_var(--color-canvas)]"
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
        className="pointer-events-none absolute bottom-0 left-[80px] top-12 w-px -translate-x-1/2 bg-[var(--color-rail)]"
      />
      <div className="mb-3 ml-2 px-1 text-[13px] font-[510] tabular text-[var(--color-fg-dim)]">
        {label}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
