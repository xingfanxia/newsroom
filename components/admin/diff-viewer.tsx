import type { DiffLine } from "@/lib/types";

const KIND_STYLES: Record<DiffLine["kind"], React.CSSProperties> = {
  add: {
    background: "rgba(63,185,80,0.06)",
    borderLeft: "2px solid var(--accent-green)",
    color: "var(--accent-green)",
  },
  remove: {
    background: "rgba(248,81,73,0.06)",
    borderLeft: "2px solid var(--accent-red)",
    color: "var(--accent-red)",
  },
  meta: {
    color: "var(--accent-blue)",
    borderLeft: "2px solid transparent",
    fontWeight: 500,
  },
  context: {
    color: "var(--fg-3)",
    borderLeft: "2px solid transparent",
  },
};

/** Narrative diff preview — +/- prefixed lines, no line numbers. */
export function DiffViewer({ lines }: { lines: DiffLine[] }) {
  return (
    <div
      style={{
        background: "var(--bg-0)",
        border: "1px solid var(--border-1)",
        borderRadius: 2,
        padding: "6px 0",
        overflowX: "auto",
        fontFamily: "var(--font-mono)",
        fontSize: 12.5,
        lineHeight: 1.75,
      }}
    >
      {lines.map((line, i) => {
        const prefix = line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  ";
        return (
          <div
            key={i}
            style={{
              padding: "1px 12px 1px 14px",
              whiteSpace: "pre-wrap",
              ...KIND_STYLES[line.kind],
            }}
          >
            <span aria-hidden style={{ display: "inline-block", width: 14, opacity: 0.6 }}>
              {prefix}
            </span>
            {line.content}
          </div>
        );
      })}
    </div>
  );
}
