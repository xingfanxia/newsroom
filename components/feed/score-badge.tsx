import { cn } from "@/lib/utils";

export function ScoreBadge({
  score,
  className,
}: {
  score: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-[38px] justify-center items-center rounded-full px-[10px] py-[1px]",
        "bg-[rgba(34,197,94,0.14)] text-[var(--color-positive)] font-[510] text-[13px] tabular font-mono leading-[1.4]",
        className,
      )}
      aria-label={`importance ${score}`}
    >
      {score}
    </span>
  );
}
