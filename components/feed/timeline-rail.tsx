import { formatTime } from "@/lib/utils";
import type { ReactNode } from "react";

export function TimelineEntry({
  date,
  children,
}: {
  date: Date;
  children: ReactNode;
}) {
  return (
    <div className="relative grid grid-cols-[80px_1fr] items-start gap-4">
      {/* timestamp gutter */}
      <div className="pt-4 text-right">
        <span className="font-mono text-[14px] font-[510] tabular text-[var(--color-fg)]">
          {formatTime(date)}
        </span>
      </div>
      {/* rail dot */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-[74px] top-[22px] h-[9px] w-[9px] rounded-full border-2 border-[var(--color-cyan-dim)] bg-[var(--color-canvas)]"
      />
      {/* card */}
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
        className="pointer-events-none absolute bottom-0 left-[80px] top-12 w-px bg-[var(--color-rail)]"
      />
      <div className="mb-3 ml-2 px-1 text-[13px] font-[510] tabular text-[var(--color-fg-dim)]">
        {label}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
