import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { newsletters } from "@/db/schema";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

type Props = {
  params: Promise<{ locale: "zh" | "en" }>;
  searchParams: Promise<{ p?: string }>;
};

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function DailyArchivePage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { p } = await searchParams;

  if (locale === "en") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-24 text-center">
        <p className="text-[var(--color-muted)]">English archive coming soon.</p>
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

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-10 border-b border-[var(--color-border)] pb-4">
        <h1 className="text-[24px] font-[600] tracking-[-0.4px] text-[var(--color-fg)]">
          每日 AI 日报存档
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-muted)]">
          AX 的 AI 日报 历史
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-[var(--color-muted)]">还没有日报。</p>
      ) : (
        <ul className="space-y-6">
          {rows.map((r) => {
            const dk = dateKey(r.periodStart);
            return (
              <li key={r.id} className="border-b border-[var(--color-border)] pb-4">
                <Link
                  href={`/zh/daily/${dk}`}
                  className="block hover:opacity-80"
                >
                  <div className="flex items-center justify-between text-[12px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                    <span>{dk}</span>
                    {r.columnThemeTag ? (
                      <span className="text-[var(--color-accent)]">
                        # {r.columnThemeTag}
                      </span>
                    ) : null}
                  </div>
                  <h2 className="mt-1 text-[17px] font-[500] text-[var(--color-fg)]">
                    {r.columnTitle}
                  </h2>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length === PAGE_SIZE ? (
        <div className="mt-12 flex justify-center">
          <Link
            href={`/zh/daily/archive?p=${page + 1}`}
            className="text-sm text-[var(--color-accent)] hover:underline"
          >
            下一页 →
          </Link>
        </div>
      ) : null}
    </main>
  );
}
