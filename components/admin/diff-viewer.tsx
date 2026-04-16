import type { DiffLine } from "@/lib/types";

export function DiffViewer({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--color-border-subtle)] bg-black/30 py-2">
      {lines.map((line, i) => {
        const cls =
          line.kind === "add"
            ? "diff-line diff-line-add"
            : line.kind === "remove"
              ? "diff-line diff-line-remove"
              : line.kind === "meta"
                ? "diff-line diff-line-meta"
                : "diff-line diff-line-context";
        const prefix =
          line.kind === "add"
            ? "+ "
            : line.kind === "remove"
              ? "- "
              : "  ";
        return (
          <div key={i} className={cls}>
            <span aria-hidden className="inline-block w-[14px] opacity-60">
              {prefix}
            </span>
            {line.content}
          </div>
        );
      })}
    </div>
  );
}
