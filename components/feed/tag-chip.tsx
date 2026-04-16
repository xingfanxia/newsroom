import { cn } from "@/lib/utils";

export function TagChip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[4px] bg-white/[0.05] px-2 py-[3px]",
        "text-[12px] font-[510] text-[var(--color-fg-muted)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
