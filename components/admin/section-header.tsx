import type { CSSProperties } from "react";

export function AdminSectionHeader({
  title,
  meta,
  metaColor,
  extraStyle,
}: {
  title: string;
  meta?: string;
  metaColor?: string;
  extraStyle?: CSSProperties;
}) {
  return (
    <h3
      style={{
        fontSize: 11,
        color: "var(--fg-3)",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        margin: "16px 0 8px",
        fontWeight: 500,
        display: "flex",
        justifyContent: "space-between",
        ...extraStyle,
      }}
    >
      <span>{title}</span>
      {meta && (
        <span style={{ color: metaColor ?? "var(--fg-0)", fontWeight: 500 }}>
          {meta}
        </span>
      )}
    </h3>
  );
}
