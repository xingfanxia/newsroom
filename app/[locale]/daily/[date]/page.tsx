import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { newsletters } from "@/db/schema";
import { ViewShell } from "@/components/shell/view-shell";
import { DailyColumnRenderer } from "../_renderer";
import {
  getPulseData,
  getRadarStats,
} from "@/lib/shell/dashboard-stats";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: "zh" | "en"; date: string }>;
};

export default async function DailyDatePage({ params }: Props) {
  const { locale, date } = await params;
  setRequestLocale(locale);
  if (locale !== "zh") notFound();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const dayStart = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(dayStart.getTime())) notFound();
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [rows, stats, pulse] = await Promise.all([
    db()
      .select({
        id: newsletters.id,
        columnTitle: newsletters.columnTitle,
        columnSummaryMd: newsletters.columnSummaryMd,
        columnNarrativeMd: newsletters.columnNarrativeMd,
        columnThemeTag: newsletters.columnThemeTag,
        publishedAt: newsletters.publishedAt,
        periodStart: newsletters.periodStart,
      })
      .from(newsletters)
      .where(
        sql`${newsletters.kind} = 'daily'
          AND ${newsletters.locale} = 'zh'
          AND ${newsletters.columnTitle} IS NOT NULL
          AND ${newsletters.periodStart} >= ${dayStart.toISOString()}::timestamptz
          AND ${newsletters.periodStart} <  ${dayEnd.toISOString()}::timestamptz`,
      )
      .orderBy(sql`${newsletters.periodStart} DESC`)
      .limit(1),
    getRadarStats().catch(() => ({
      items_today: 0,
      items_p1: 0,
      items_featured: 0,
      tracked_sources: 0,
    })),
    getPulseData().catch(() => []),
  ]);

  if (rows.length === 0) notFound();
  const r = rows[0]!;

  return (
    <ViewShell
      locale="zh"
      stats={{
        tracked_sources: stats.tracked_sources,
        signal_ratio: 0.72,
      }}
      pulse={pulse}
      crumb={`~/daily/${date}`}
      cmd={`cat newsletter/daily/${date}.md`}
    >
      <main className="main">
        <DailyColumnRenderer
          column={{
            id: r.id,
            columnTitle: r.columnTitle ?? "",
            columnSummaryMd: r.columnSummaryMd ?? "",
            columnNarrativeMd: r.columnNarrativeMd ?? "",
            columnThemeTag: r.columnThemeTag,
            publishedAt: r.publishedAt,
            periodStart: r.periodStart,
          }}
        />
      </main>
    </ViewShell>
  );
}
