import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { ComingSoonPanel } from "@/components/shell/coming-soon-panel";
import { getRadarStats } from "@/lib/shell/dashboard-stats";
import { totalsByWindow } from "@/lib/llm/stats";

export const dynamic = "force-dynamic";

/**
 * /admin/usage — LLM spend + token mix view. The existing /admin/system
 * already renders detailed spend tables; Usage focuses on the high-level
 * "how much are we burning" numbers so ops can glance at the hero.
 */
export default async function UsagePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [today, week, month, stats] = await Promise.all([
    totalsByWindow("today").catch(() => null),
    totalsByWindow("week").catch(() => null),
    totalsByWindow("month").catch(() => null),
    getRadarStats().catch(() => ({
      items_today: 0, items_p1: 0, items_featured: 0, tracked_sources: 0,
    })),
  ]);

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{ tracked_sources: stats.tracked_sources, signal_ratio: 0.72 }}
      crumb="~/admin/usage"
      cmd="grep -R cost_usd llm_usage/*.log | awk '{sum+=$3} END {print sum}'"
    >
      <main className="main">
        <PageHead
          en="usage"
          cjk="用量"
          extra={<span>LLM spend · token mix · last 30 days</span>}
        />
        {today && week && month ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 16,
              marginTop: 14,
            }}
          >
            <SpendCard label="today" totals={today} />
            <SpendCard label="7d" totals={week} />
            <SpendCard label="30d" totals={month} />
          </div>
        ) : (
          <ComingSoonPanel en="usage telemetry" cjk="用量遥测" />
        )}
      </main>
    </ViewShell>
  );
}

function SpendCard({
  label,
  totals,
}: {
  label: string;
  totals: {
    calls: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    costUsd: number;
  };
}) {
  return (
    <div className="panel">
      <div className="hd">
        <span className="t">{label}</span>
        <span className="more">usd</span>
      </div>
      <div className="bd">
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 28,
            color: "var(--accent-blue)",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
          }}
        >
          ${totals.costUsd.toFixed(4)}
        </div>
        <div
          style={{
            marginTop: 10,
            display: "grid",
            gridTemplateColumns: "1fr auto",
            columnGap: 10,
            rowGap: 4,
            fontSize: 11,
            color: "var(--fg-3)",
          }}
        >
          <span>calls</span>
          <span
            style={{
              color: "var(--fg-1)",
              fontVariantNumeric: "tabular-nums",
              textAlign: "right",
            }}
          >
            {totals.calls}
          </span>
          <span>input tok</span>
          <span
            style={{
              color: "var(--fg-1)",
              fontVariantNumeric: "tabular-nums",
              textAlign: "right",
            }}
          >
            {formatTokens(totals.inputTokens)}
          </span>
          <span>cached</span>
          <span
            style={{
              color: "var(--fg-1)",
              fontVariantNumeric: "tabular-nums",
              textAlign: "right",
            }}
          >
            {formatTokens(totals.cachedInputTokens)}
          </span>
          <span>output</span>
          <span
            style={{
              color: "var(--fg-1)",
              fontVariantNumeric: "tabular-nums",
              textAlign: "right",
            }}
          >
            {formatTokens(totals.outputTokens)}
          </span>
          {totals.reasoningTokens > 0 && (
            <>
              <span>reasoning</span>
              <span
                style={{
                  color: "var(--fg-1)",
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "right",
                }}
              >
                {formatTokens(totals.reasoningTokens)}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
