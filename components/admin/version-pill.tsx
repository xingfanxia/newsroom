/**
 * Version tag — green-tinted terminal pill for policy versions (v1, v2…).
 * Matches the `.tier-f` chip style used in feed item meta rows.
 */
export function VersionPill({
  version,
  className,
}: {
  version: string;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        color: "var(--accent-green)",
        background: "rgba(63,185,80,0.08)",
        border: "1px solid rgba(63,185,80,0.3)",
        padding: "2px 8px",
        borderRadius: 2,
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "0.04em",
        fontWeight: 700,
      }}
    >
      {version}
    </span>
  );
}
