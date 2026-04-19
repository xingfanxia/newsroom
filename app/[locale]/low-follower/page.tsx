import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { ComingSoonPanel } from "@/components/shell/coming-soon-panel";
import { getPulseData, getRadarStats } from "@/lib/shell/dashboard-stats";

export default async function LowFollowerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [stats, pulse] = await Promise.all([
    getRadarStats().catch(() => ({
      items_today: 0,
      items_p1: 0,
      items_featured: 0,
      tracked_sources: 0,
    })),
    getPulseData().catch(() => []),
  ]);

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{
        tracked_sources: stats.tracked_sources,
        signal_ratio: 0.72,
      }}
      pulse={pulse}
      crumb="~/viral"
      cmd="awk '$followers < 5000 && $engagement > 0.2'"
    >
      <main className="main">
        <PageHead en="viral" cjk="低粉爆文" />
        <ComingSoonPanel en="low-follower viral posts" cjk="低粉爆文" />
      </main>
    </ViewShell>
  );
}
