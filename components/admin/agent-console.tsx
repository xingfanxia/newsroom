import { useTranslations } from "next-intl";
import type { IterationConsoleLine } from "@/lib/types";

const DOT_COLORS: Record<IterationConsoleLine["kind"], string> = {
  info: "var(--accent-blue)",
  reading: "var(--accent-orange)",
  done: "var(--fg-3)",
  success: "var(--accent-green)",
};

/**
 * Agent run output — rendered as a `$`-prefixed command log, one line per
 * step, colored dot to signal state (queued / working / done / success).
 */
export function AgentConsole({ lines }: { lines: IterationConsoleLine[] }) {
  const t = useTranslations("iteration.console.lines");
  return (
    <div
      role="log"
      style={{
        background: "var(--bg-0)",
        border: "1px solid var(--border-1)",
        borderRadius: 2,
        padding: 14,
        fontFamily: "var(--font-mono)",
        fontSize: 12.5,
        lineHeight: 1.85,
        overflowX: "auto",
      }}
    >
      {lines.map((line) => (
        <div
          key={line.key}
          style={{ display: "flex", alignItems: "baseline", gap: 10 }}
        >
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: DOT_COLORS[line.kind],
              boxShadow:
                line.kind === "success" ? "0 0 5px var(--tint-green-40)" : "none",
              marginTop: 6,
            }}
          />
          <span style={{ color: "var(--accent-green)", fontWeight: 700 }}>$</span>
          <span style={{ color: "var(--fg-1)" }}>{t(line.key, line.params)}</span>
        </div>
      ))}
    </div>
  );
}
