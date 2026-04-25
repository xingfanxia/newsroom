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

export function DailyColumnRenderer({ column }: { column: ColumnRow }) {
  const dateLabel = formatDate(column.periodStart);
  const issueId = `AX 的 AI 日报 · ${dateKey(column.periodStart)}`;
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-10 border-b border-[var(--color-border)] pb-6">
        <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-[var(--color-muted)]">
          <span>{issueId}</span>
          {column.columnThemeTag ? (
            <span className="text-[var(--color-accent)]">
              # {column.columnThemeTag}
            </span>
          ) : null}
        </div>
        <h1 className="mt-3 text-[28px] font-[600] tracking-[-0.4px] leading-tight text-[var(--color-fg)]">
          {column.columnTitle}
        </h1>
        <time
          className="mt-2 block text-[13px] text-[var(--color-muted)]"
          dateTime={column.periodStart.toISOString()}
        >
          {dateLabel}
        </time>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-[15px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          今日五件事
        </h2>
        <Prose>{column.columnSummaryMd}</Prose>
      </section>

      <section className="border-t border-[var(--color-border)] pt-8">
        <Prose>{column.columnNarrativeMd}</Prose>
      </section>

      <footer className="mt-16 border-t border-[var(--color-border)] pt-6 text-xs text-[var(--color-muted)]">
        <Link
          href="/zh/daily/archive"
          className="text-[var(--color-accent)] hover:underline"
        >
          ← 历史日报
        </Link>
      </footer>
    </article>
  );
}
