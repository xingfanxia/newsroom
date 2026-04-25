import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { newsletters } from "@/db/schema";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

type Props = {
  params: Promise<{ locale: "zh" | "en" }>;
  searchParams: Promise<{ p?: string }>;
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
 * Strip markdown formatting + numbering from the summary, take the first
 * meaningful sentence as a card preview. Cheap parser — good enough for cards.
 */
function summaryPreview(summaryMd: string): string {
  // Drop leading numbered marker, brackets/ids, link syntax. Take first ~120 chars.
  const stripped = summaryMd
    .replace(/^\s*\d+\.\s*/, "")
    .replace(/\[#\d+\]\([^)]*\)/g, "")
    .replace(/\[#\d+\]/g, "")
    .replace(/[#*_`]/g, "")
    .trim();
  // First numbered entry is on the first line; first sentence-ish.
  const firstLine = stripped.split(/\n/)[0] ?? "";
  return firstLine.length > 140
    ? `${firstLine.slice(0, 140).trim()}…`
    : firstLine;
}

export default async function DailyLandingPage({
  params,
  searchParams,
}: Props) {
  const { locale } = await params;
  const { p } = await searchParams;

  if (locale === "en") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold text-[var(--color-fg)]">
          Daily Column
        </h1>
        <p className="mt-4 text-[var(--color-muted)]">
          English edition coming soon. The current daily ships in Chinese only;
          subscribe to the RSS or check back when the English voice is ready.
        </p>
      </main>
    );
  }

  const page = Math.max(1, Number(p ?? "1"));
  const offset = (page - 1) * PAGE_SIZE;

  const client = db();
  const rows = await client
    .select({
      id: newsletters.id,
      columnTitle: newsletters.columnTitle,
      columnSummaryMd: newsletters.columnSummaryMd,
      columnThemeTag: newsletters.columnThemeTag,
      periodStart: newsletters.periodStart,
    })
    .from(newsletters)
    .where(
      sql`${newsletters.kind} = 'daily'
        AND ${newsletters.locale} = 'zh'
        AND ${newsletters.columnTitle} IS NOT NULL`,
    )
    .orderBy(sql`${newsletters.periodStart} DESC`)
    .limit(PAGE_SIZE)
    .offset(offset);

  if (rows.length === 0 && page === 1) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold text-[var(--color-fg)]">
          每日 AI 日报
        </h1>
        <p className="mt-4 text-[var(--color-muted)]">
          今日的日报还没生成，明天再来。
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-10 border-b border-[var(--color-border)] pb-6">
        <h1 className="text-[26px] font-[600] tracking-[-0.4px] text-[var(--color-fg)]">
          每日 AI 日报
        </h1>
        <p className="mt-2 text-[13px] text-[var(--color-muted)]">
          每天 9pm PT 一篇 2500-4500 字编辑视角，主笔风格参考「数字生命卡兹克」。
          也可以订阅 <Link href="/api/rss/daily.xml" className="text-[var(--color-accent)] hover:underline">RSS</Link>。
        </p>
      </header>

      <ul className="space-y-8">
        {rows.map((r, i) => {
          const dk = dateKey(r.periodStart);
          const isLatest = page === 1 && i === 0;
          const preview = summaryPreview(r.columnSummaryMd ?? "");
          return (
            <li
              key={r.id}
              className={
                isLatest
                  ? "border-b border-[var(--color-border)] pb-8"
                  : "border-b border-[var(--color-border)]/60 pb-6"
              }
            >
              <Link href={`/zh/daily/${dk}`} className="group block">
                <div className="flex items-center justify-between text-[12px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  <span>
                    {isLatest ? "今日 · " : ""}
                    AX 的 AI 日报 · {dk}
                  </span>
                  {r.columnThemeTag ? (
                    <span className="text-[var(--color-accent)]">
                      # {r.columnThemeTag}
                    </span>
                  ) : null}
                </div>
                <h2
                  className={
                    isLatest
                      ? "mt-2 text-[24px] font-[600] tracking-[-0.4px] leading-tight text-[var(--color-fg)] group-hover:text-[var(--color-accent)]"
                      : "mt-2 text-[18px] font-[500] text-[var(--color-fg)] group-hover:text-[var(--color-accent)]"
                  }
                >
                  {r.columnTitle}
                </h2>
                {preview ? (
                  <p
                    className={
                      isLatest
                        ? "mt-3 text-[14.5px] leading-[1.65] text-[var(--color-muted)]"
                        : "mt-1.5 text-[13.5px] leading-[1.6] text-[var(--color-muted)] line-clamp-2"
                    }
                  >
                    {preview}
                  </p>
                ) : null}
                <div className="mt-2 text-[12px] text-[var(--color-muted)]">
                  <time dateTime={r.periodStart.toISOString()}>
                    {formatDate(r.periodStart)}
                  </time>
                  <span className="ml-3 text-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity">
                    阅读 →
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <nav className="mt-12 flex items-center justify-between text-sm">
        {page > 1 ? (
          <Link
            href={`/zh/daily${page === 2 ? "" : `?p=${page - 1}`}`}
            className="text-[var(--color-accent)] hover:underline"
          >
            ← 较新
          </Link>
        ) : (
          <span />
        )}
        {rows.length === PAGE_SIZE ? (
          <Link
            href={`/zh/daily?p=${page + 1}`}
            className="text-[var(--color-accent)] hover:underline"
          >
            较旧 →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
