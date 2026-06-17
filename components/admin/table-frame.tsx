import type { CSSProperties, ReactNode } from "react";

export function AdminTableFrame({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
