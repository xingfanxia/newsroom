import { cn } from "@/lib/utils";

export function VersionPill({
  version,
  className,
}: {
  version: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded bg-[rgba(34,197,94,0.14)] px-[10px] py-[3px]",
        "font-mono text-[12px] font-[510] tabular text-[var(--color-positive)]",
        className,
      )}
    >
      {version}
    </span>
  );
}
