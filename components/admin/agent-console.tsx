import { useTranslations } from "next-intl";
import type { IterationConsoleLine } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AgentConsole({ lines }: { lines: IterationConsoleLine[] }) {
  const t = useTranslations("iteration.console.lines");
  return (
    <div
      className="rounded-lg border border-[var(--color-border-subtle)] bg-black/30 p-5 font-mono text-[13.5px] leading-[1.9]"
      role="log"
    >
      {lines.map((line) => (
        <div key={line.key} className="flex items-baseline gap-[10px]">
          <span
            className={cn(
              "console-dot",
              line.kind === "info" && "console-dot-info",
              line.kind === "reading" && "console-dot-reading",
              line.kind === "done" && "console-dot-done",
              line.kind === "success" && "console-dot-success",
            )}
          />
          <span className="text-[var(--color-fg-muted)]">
            {t(line.key, line.params)}
          </span>
        </div>
      ))}
    </div>
  );
}
