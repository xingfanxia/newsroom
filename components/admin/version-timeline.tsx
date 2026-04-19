import { VersionPill } from "@/components/admin/version-pill";

export type TimelineVersion = {
  version: number;
  committedAt: string; // ISO
  committedBy: string | null;
  feedbackCount: number;
  reasoning: string | null;
};

/**
 * Vertical timeline of policy versions. Each node = one `policy_versions` row.
 * The rail is a 2px vertical line; the active version gets a filled green
 * marker, earlier ones get hollow grey markers. Most recent at top.
 */
export function VersionTimeline({
  locale,
  versions,
}: {
  locale: "en" | "zh";
  versions: TimelineVersion[];
}) {
  const zh = locale === "zh";
  const timeFmt = new Intl.DateTimeFormat(zh ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (versions.length === 0) {
    return (
      <div
        style={{
          padding: "28px 16px",
          textAlign: "center",
          color: "var(--fg-3)",
          border: "1px dashed var(--border-1)",
          fontSize: 12,
        }}
      >
        {zh ? "尚无版本提交" : "no versions committed yet"}
      </div>
    );
  }
  return (
    <ol
      style={{
        listStyle: "none",
        margin: 0,
        padding: "4px 0 4px 20px",
        position: "relative",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 5,
          top: 10,
          bottom: 10,
          width: 2,
          background: "var(--border-1)",
        }}
      />
      {versions.map((v, i) => {
        const active = i === 0;
        return (
          <li
            key={v.version}
            style={{
              position: "relative",
              padding: "12px 0",
              borderBottom:
                i === versions.length - 1
                  ? "none"
                  : "1px dashed var(--border-1)",
            }}
          >
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: -20,
                top: 16,
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: active ? "var(--accent-green)" : "var(--bg-2)",
                border: `2px solid ${active ? "var(--accent-green)" : "var(--border-2)"}`,
                boxShadow: active ? "0 0 6px var(--tint-green-40)" : "none",
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                flexWrap: "wrap",
                marginBottom: v.reasoning ? 6 : 0,
              }}
            >
              <VersionPill version={`v${v.version}`} />
              <span
                style={{
                  fontSize: 11,
                  color: "var(--fg-3)",
                  fontFamily: "var(--font-mono)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {timeFmt.format(new Date(v.committedAt))}
              </span>
              {v.committedBy && (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--fg-2)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  · {v.committedBy}
                </span>
              )}
              <span
                style={{
                  fontSize: 11,
                  color: "var(--fg-3)",
                  marginLeft: "auto",
                  fontFamily: "var(--font-mono)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {v.feedbackCount}{" "}
                {zh ? "条反馈" : v.feedbackCount === 1 ? "feedback" : "feedbacks"}
              </span>
            </div>
            {v.reasoning && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--fg-1)",
                  lineHeight: 1.6,
                  paddingLeft: 2,
                  fontFamily:
                    zh ? "var(--font-sans-cjk)" : "var(--font-mono)",
                }}
              >
                {v.reasoning}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
