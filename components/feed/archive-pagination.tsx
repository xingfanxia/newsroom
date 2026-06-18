import type { AppLocale } from "@/lib/types";

type PreservedPaginationParam = string | null | undefined;

type FeedArchivePaginationProps = {
  basePath: string;
  offset: number;
  pageSize: number;
  currentCount: number;
  locale: AppLocale;
  preservedParams?: Record<string, PreservedPaginationParam>;
};

export function feedArchivePageHref(
  basePath: string,
  nextOffset: number,
  preservedParams: Record<string, PreservedPaginationParam> = {},
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(preservedParams)) {
    if (value) qs.set(key, value);
  }
  if (nextOffset > 0) qs.set("offset", String(nextOffset));
  const s = qs.toString();
  return `${basePath}${s ? `?${s}` : ""}`;
}

export function FeedArchivePagination({
  basePath,
  offset,
  pageSize,
  currentCount,
  locale,
  preservedParams,
}: FeedArchivePaginationProps) {
  const zh = locale === "zh";
  const prevOffset = Math.max(0, offset - pageSize);
  const nextOffset = offset + pageSize;
  const hasNext = currentCount >= pageSize;
  const hasPrev = offset > 0;
  const pageNum = Math.floor(offset / pageSize) + 1;

  return (
    <nav
      aria-label={zh ? "分页" : "pagination"}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "18px 0 40px",
        gap: 12,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--fg-3)",
        borderTop: "1px dashed var(--border-1)",
        marginTop: 18,
      }}
    >
      {hasPrev ? (
        <a
          href={feedArchivePageHref(basePath, prevOffset, preservedParams)}
          className="mini-btn"
        >
          ← {zh ? "上一页" : "newer"}
        </a>
      ) : (
        <span style={{ opacity: 0.3 }}>← {zh ? "上一页" : "newer"}</span>
      )}
      <span style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {zh ? "第" : "page"} {pageNum} · {offset + 1}&ndash;
        {offset + currentCount}
      </span>
      {hasNext ? (
        <a
          href={feedArchivePageHref(basePath, nextOffset, preservedParams)}
          className="mini-btn"
        >
          {zh ? "下一页" : "older"} →
        </a>
      ) : (
        <span style={{ opacity: 0.3 }}>{zh ? "下一页" : "older"} →</span>
      )}
    </nav>
  );
}
