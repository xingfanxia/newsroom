import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { DailyColumnRenderer } from "../_renderer";
import { getShellChromeData } from "@/lib/shell/chrome-data";
import {
  dailyColumnDateSchema,
  getDailyColumnRowByDate,
} from "@/lib/api/daily-columns";
import { appLocaleFromParam, DAILY_COLUMN_LOCALE } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string; date: string }>;
};

export default async function DailyDatePage({ params }: Props) {
  const { locale, date } = await params;
  const appLocale = appLocaleFromParam(locale);
  setRequestLocale(appLocale);
  if (appLocale !== DAILY_COLUMN_LOCALE) notFound();
  const parsedDate = dailyColumnDateSchema.safeParse(date);
  if (!parsedDate.success) notFound();

  const [row, chrome] = await Promise.all([
    getDailyColumnRowByDate(parsedDate.data, DAILY_COLUMN_LOCALE),
    getShellChromeData({ pulse: true }),
  ]);

  if (!row) notFound();

  return (
    <ViewShell
      locale={appLocale}
      stats={chrome.topBarStats}
      pulse={chrome.pulse}
      crumb={`~/daily/${date}`}
      cmd={`cat newsletter/daily/${date}.md`}
    >
      <main className="main">
        <DailyColumnRenderer
          column={{
            id: row.id,
            columnTitle: row.columnTitle ?? "",
            columnSummaryMd: row.columnSummaryMd ?? "",
            columnNarrativeMd: row.columnNarrativeMd ?? "",
            columnThemeTag: row.columnThemeTag,
            publishedAt: row.publishedAt,
            periodStart: row.periodStart,
            aihotDailyDate: row.aihotDailyDate,
          }}
        />
      </main>
    </ViewShell>
  );
}
