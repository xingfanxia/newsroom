import type { CSSProperties, ReactNode } from "react";

export function AdminMonoBlock({
  children,
  tone = "normal",
  style,
}: {
  children: ReactNode;
  tone?: "normal" | "error";
  style?: CSSProperties;
}) {
  return (
    <pre
      style={{
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
        padding: 20,
        fontFamily: "var(--font-mono)",
        fontSize: 12.5,
        lineHeight: 1.75,
        color: tone === "error" ? "var(--accent-red)" : "var(--fg-1)",
        whiteSpace: "pre-wrap",
        borderRadius: 2,
        ...style,
      }}
    >
      {children}
    </pre>
  );
}
