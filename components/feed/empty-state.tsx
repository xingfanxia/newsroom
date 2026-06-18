import type { CSSProperties, ReactNode } from "react";

type FeedEmptyStateProps = {
  children: ReactNode;
  framed?: boolean;
  style?: CSSProperties;
};

export function FeedEmptyState({
  children,
  framed = false,
  style,
}: FeedEmptyStateProps) {
  return (
    <div
      style={{
        padding: 60,
        color: "var(--fg-3)",
        textAlign: "center",
        ...(framed
          ? {
              border: "1px dashed var(--border-1)",
              borderRadius: 2,
              marginTop: 10,
            }
          : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
