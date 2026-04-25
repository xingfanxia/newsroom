import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { newsletters } from "@/db/schema";
import { DailyColumnRenderer } from "./_renderer";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: "zh" | "en" }>;
};

export default async function DailyLandingPage({ params }: Props) {
  const { locale } = await params;

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
        AND ${newsletters.columnTitle} IS NOT NULL`,
    )
    .orderBy(sql`${newsletters.periodStart} DESC`)
    .limit(1);

  if (rows.length === 0) {
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
