import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { DailyColumnRenderer } from "../_renderer";
import { getShellChromeData } from "@/lib/shell/chrome-data";
import {
  dailyColumnDateSchema,
  getDailyColumnRowByDate,
} from "@/lib/api/daily-columns";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: "zh" | "en"; date: string }>;
};

export default async function DailyDatePage({ params }: Props) {
  const { locale, date } = await params;
  setRequestLocale(locale);
  if (locale !== "zh") notFound();
  const parsedDate = dailyColumnDateSchema.safeParse(date);
  if (!parsedDate.success) notFound();

  const [row, chrome] = await Promise.all([
    getDailyColumnRowByDate(parsedDate.data, "zh"),
    getShellChromeData({ pulse: true }),
  ]);

  if (!row) notFound();

  return (
    <ViewShell
      locale="zh"
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
