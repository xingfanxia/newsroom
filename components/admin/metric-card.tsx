import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  note,
  tone = "default",
  className,
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: "default" | "positive" | "negative";
  className?: string;
}) {
  const valueColor =
    tone === "positive"
      ? "text-[var(--color-positive)]"
      : tone === "negative"
        ? "text-[var(--color-warning)]"
        : "text-[var(--color-fg)]";

  return (
    <div className={cn("surface-elevated p-6", className)}>
      <div className="text-[13px] font-[510] text-[var(--color-fg-muted)]">
        {label}
      </div>
      <div
        className={cn(
          "mt-3 font-[510] text-[44px] leading-none tabular tracking-tight",
          valueColor,
        )}
      >
        {value}
      </div>
      {note && (
        <div className="mt-3 text-[13px] leading-relaxed text-[var(--color-fg-dim)]">
          {note}
        </div>
      )}
    </div>
  );
}
