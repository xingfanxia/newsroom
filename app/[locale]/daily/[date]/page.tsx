import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { newsletters } from "@/db/schema";
import { DailyColumnRenderer } from "../_renderer";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: "zh" | "en"; date: string }>;
};

export default async function DailyDatePage({ params }: Props) {
  const { locale, date } = await params;
  if (locale !== "zh") notFound();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const dayStart = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(dayStart.getTime())) notFound();
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const client = db();
  const rows = await client
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
    .limit(1);

  if (rows.length === 0) notFound();
  const r = rows[0]!;

  return (
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
  );
}
