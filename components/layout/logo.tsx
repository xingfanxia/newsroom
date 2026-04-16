import { cn } from "@/lib/utils";

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
        "surface-card relative flex items-center justify-center gap-1 px-3 py-2 min-w-[92px]",
        "bg-[rgba(62,230,230,0.02)] border-[rgba(62,230,230,0.08)]",
        className,
      )}
      style={{ height: size }}
      aria-label="AI·HOT"
    >
      <span className="font-[590] tracking-tight text-[var(--color-fg)] text-[15px]">
        AI
      </span>
      <span className="relative flex h-4 w-4 items-center justify-center">
        <span
          className="h-3 w-3 rounded-full border border-[var(--color-cyan)] opacity-80"
          aria-hidden
        />
        <span
          className="absolute h-1.5 w-1.5 rounded-full bg-[var(--color-cyan)] shadow-[0_0_10px_rgba(62,230,230,0.8)] orbit"
          style={{ transform: "translate(5px, 0)" }}
          aria-hidden
        />
      </span>
      <span className="font-[590] tracking-tight text-[var(--color-cyan)] text-[15px]">
        HOT
      </span>
    </div>
  );
}
