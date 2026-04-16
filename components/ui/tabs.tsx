"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export type TabItem<T extends string = string> = {
  value: T;
  label: React.ReactNode;
};

export function PillTabs<T extends string>({
  items,
  value,
  onValueChange,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onValueChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] bg-white/[0.02] p-1",
        className,
      )}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            type="button"
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(it.value)}
            className={cn(
              "h-7 rounded-full px-3 text-[12px] font-[510] transition-all",
              active
                ? "bg-[rgba(62,230,230,0.12)] text-[var(--color-cyan)] shadow-[inset_0_0_0_1px_rgba(62,230,230,0.3)]"
                : "text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] hover:bg-white/[0.04]",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
