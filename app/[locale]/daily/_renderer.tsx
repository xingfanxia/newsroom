import Link from "next/link";
import { Prose } from "@/components/markdown/prose";

export type ColumnRow = {
  id: number;
  columnTitle: string;
  columnSummaryMd: string;
  columnNarrativeMd: string;
  columnThemeTag: string | null;
  publishedAt: Date;
  periodStart: Date;
};

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

/**
 * Rewrite reader-meaningless [#NNNN] item refs as clickable links to the
 * item detail page. react-markdown round-trips `[label](url)` cleanly so
 * we just inject the URL inline.
 */
function linkifyItemRefs(md: string): string {
  return md.replace(/\[#(\d+)\]/g, (_, id) => `[#${id}](/zh/items/${id})`);
}

export function DailyColumnRenderer({ column }: { column: ColumnRow }) {
  const dateLabel = formatDate(column.periodStart);
  const issueId = `AX 的 AI 日报 · ${dateKey(column.periodStart)}`;
  const summary = linkifyItemRefs(column.columnSummaryMd);
  const narrative = linkifyItemRefs(column.columnNarrativeMd);

  return (
    <article className="daily-article">
      <header className="daily-head">
        <div className="daily-meta">
          <span className="daily-issue">{issueId}</span>
          {column.columnThemeTag ? (
            <span className="tier-f">{column.columnThemeTag}</span>
          ) : null}
        </div>
        <h1 className="daily-title">{column.columnTitle}</h1>
        <time className="daily-date" dateTime={column.periodStart.toISOString()}>
          {dateLabel}
        </time>
      </header>

      <section className="daily-section">
        <div className="daily-section-label">今日五件事</div>
        <Prose>{summary}</Prose>
      </section>

      <section className="daily-section daily-section--narrative">
        <Prose>{narrative}</Prose>
      </section>

      <footer className="daily-foot">
        <Link
          href="/zh/daily"
          className="text-[var(--color-cyan,var(--accent-blue))] underline underline-offset-4 decoration-[currentColor]/40 hover:decoration-[currentColor]"
        >
          ← 全部日报
        </Link>
      </footer>
    </article>
  );
}
