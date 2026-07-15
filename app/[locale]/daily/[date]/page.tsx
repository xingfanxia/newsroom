import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { DailyColumnRenderer } from "../_renderer";
import { isPublicDailyDate } from "@/lib/public-content/public-dailies";
import { readDailyDatePageModel } from "@/lib/public-content/page-models";
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
  if (!isPublicDailyDate(date)) notFound();

  const { row, chrome } = await readDailyDatePageModel({
    locale: DAILY_COLUMN_LOCALE,
    date,
  });

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
            columnTitle: row.title ?? "",
            columnSummaryMd: row.summary_md ?? "",
            columnNarrativeMd: row.narrative_md ?? "",
            columnThemeTag: row.theme_tag,
            publishedAt: new Date(row.generated_at),
            periodStart: new Date(row.window_start),
            aihotDailyDate: null,
          }}
        />
      </main>
    </ViewShell>
  );
}
