import Link from "next/link";
import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { getShellChromeData } from "@/lib/shell/chrome-data";
import {
  dailyColumnDateKey,
  listDailyColumnRows,
} from "@/lib/api/daily-columns";
import { formatCoarseRelativeTime } from "@/lib/time/relative";
import { appLocaleFromParam } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ p?: string }>;
};

function shortDate(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}·${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Pull a clean preview from columnSummaryMd: drop numbered marker, link
 * syntax, and `[#NNNN]` refs. Take ~160 chars from the first item.
 */
function summaryPreview(summaryMd: string): string {
  const stripped = summaryMd
    .replace(/\[#\d+\]\([^)]*\)/g, "")
    .replace(/\[#\d+\]/g, "")
    .replace(/^\s*\d+\.\s*/, "")
    .replace(/[*_`]/g, "")
    .trim();
  const firstLine = stripped.split(/\n/)[0] ?? "";
  return firstLine.length > 160
    ? `${firstLine.slice(0, 160).trim()}…`
    : firstLine;
}

export default async function DailyLandingPage({
  params,
  searchParams,
}: Props) {
  const { locale } = await params;
  const appLocale = appLocaleFromParam(locale);
  setRequestLocale(appLocale);
  const { p } = await searchParams;
  const page = Math.max(1, Number(p ?? "1"));
  const offset = (page - 1) * PAGE_SIZE;
  const isZh = appLocale === "zh";

  const [rows, chrome] = await Promise.all([
    isZh
      ? listDailyColumnRows({ locale: "zh", take: PAGE_SIZE, offset })
      : Promise.resolve([]),
    getShellChromeData({ pulse: true }),
  ]);

  return (
    <ViewShell
      locale={appLocale}
      stats={chrome.topBarStats}
      pulse={chrome.pulse}
      crumb="~/daily"
      cmd="cat newsletter/daily/*.md"
    >
      <main className="main">
        <PageHead
          en="ax daily"
          cjk="每日 AI 日报"
          count={rows.length}
          countLabel={isZh ? "篇" : "issues"}
          extra={
            <span>
              每天 9pm PT · 2500-4500 字编辑视角 · 主笔风格参考「数字生命卡兹克」 ·{" "}
              <Link
                href="/api/rss/daily.xml"
                className="text-[var(--color-cyan)] underline underline-offset-4 decoration-[var(--color-cyan)]/40 hover:decoration-[var(--color-cyan)]"
              >
                RSS
              </Link>
            </span>
          }
        />

        {!isZh ? (
          <p className="my-8 text-[var(--fg-2)]">
            English edition coming soon. The current daily ships in Chinese
            only; subscribe to the RSS or check back when the English voice is
            ready.
          </p>
        ) : rows.length === 0 ? (
          <p className="my-8 text-[var(--fg-2)]">
            今日的日报还没生成，明天再来。
          </p>
        ) : (
          <>
            <div className="feed">
              {rows.map((r) => {
                const dk = dailyColumnDateKey(r.periodStart);
                const preview = summaryPreview(r.columnSummaryMd ?? "");
                return (
                  <Link
                    href={`/zh/daily/${dk}`}
                    key={r.id}
                    className="item"
                    style={{
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <div className="i-time">
                      <div className="hh">{shortDate(r.periodStart)}</div>
                      <div className="ago">
                        {formatCoarseRelativeTime(r.periodStart)}
                      </div>
                    </div>
                    <div className="i-body">
                      <div className="i-meta">
                        <span className="src">每日 AI 日报</span>
                        <span className="chan">· {dk}</span>
                        {r.columnThemeTag ? (
                          <span className="tier-f">{r.columnThemeTag}</span>
                        ) : null}
                      </div>
                      <div className="i-title">{r.columnTitle}</div>
                      {preview ? <div className="i-sum">{preview}</div> : null}
                    </div>
                    <div />
                  </Link>
                );
              })}
            </div>

            <nav className="mt-12 flex items-center justify-between text-sm">
              {page > 1 ? (
                <Link
                  href={`/zh/daily${page === 2 ? "" : `?p=${page - 1}`}`}
                  className="text-[var(--color-cyan)] underline underline-offset-4 decoration-[var(--color-cyan)]/40 hover:decoration-[var(--color-cyan)]"
                >
                  ← 较新
                </Link>
              ) : (
                <span />
              )}
              {rows.length === PAGE_SIZE ? (
                <Link
                  href={`/zh/daily?p=${page + 1}`}
                  className="text-[var(--color-cyan)] underline underline-offset-4 decoration-[var(--color-cyan)]/40 hover:decoration-[var(--color-cyan)]"
                >
                  较旧 →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          </>
        )}
      </main>
    </ViewShell>
  );
}
