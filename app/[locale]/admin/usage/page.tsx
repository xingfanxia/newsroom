import Link from "next/link";
import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { getShellChromeData } from "@/lib/shell/chrome-data";
import {
  getUsageDashboardSummary,
  USAGE_WINDOWS,
  usageWindowFromParam,
  type WindowTotals,
} from "@/lib/api/usage-summary";
import {
  USAGE_RANGE_LABELS,
  formatUsageCount,
  formatUsageShortDate,
  formatUsageTokens,
  usageRangeLabel,
} from "@/lib/llm/usage-display";
import { UsageBreakdownTables } from "./_usage-tables";
import { appLocaleFromParam } from "@/lib/types";

export const dynamic = "force-dynamic";

const MONTHLY_CAP_USD = Number(process.env.USAGE_MONTHLY_CAP_USD ?? 1000);

/**
 * /admin/usage — full LLM-spend view matching the design demo.
 *
 * Rendered server-side with `?range=today|week|month|all` driving the selected
 * window. All data backed by the real llm_usage table: totals for today/
 * week/month/all, cost by task with share %, cost by model, 30d daily-spend
 * sparkline, and the 25 most recent calls.
 */
export default async function UsagePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  const appLocale = appLocaleFromParam(locale);
  setRequestLocale(appLocale);
  const zh = appLocale === "zh";
  const usageLocale = appLocale;
  const range = usageWindowFromParam(sp.range);

  const [usage, chrome] = await Promise.all([
    getUsageDashboardSummary(range, { recentLimit: 25, dailyDays: 30 }),
    getShellChromeData(),
  ]);
  const { selected, dailySpend: daily } = usage;
  const { today, week, month, all } = usage.windowTotals;

  const peakDaily = Math.max(1, ...daily.map((d) => d.spend));
  const usedPct = Math.min(
    100,
    Math.round(((month?.costUsd ?? 0) / MONTHLY_CAP_USD) * 100),
  );
  const tokMixTotal = selected.inputTokens + selected.outputTokens || 1;
  const inputPct = Math.round((selected.inputTokens / tokMixTotal) * 100);
  const outputPct = 100 - inputPct;

  return (
    <ViewShell
      locale={appLocale}
      stats={chrome.topBarStats}
      crumb="~/admin/usage"
      cmd="aws ce get-cost-and-usage --granularity DAILY"
    >
      <main className="main">
        <PageHead
          en="usage"
          cjk="用量"
          live={zh ? "计费实时" : "billing current"}
          extra={
            <span>
              {zh ? "监控窗口" : "window"} {USAGE_RANGE_LABELS[range].en} ·{" "}
              {selected.calls} {zh ? "次调用" : "calls"}
            </span>
          }
          policyLabel={`cap $${MONTHLY_CAP_USD}`}
        />

        {/* Range pills — server-rendered via ?range=; client JS not needed */}
        <nav
          className="filters"
          aria-label={zh ? "时段" : "range"}
          style={{ display: "flex", gap: 8, margin: "12px 0 4px", flexWrap: "wrap" }}
        >
          <div className="fil-grp" style={{ display: "flex", gap: 6 }}>
            {USAGE_WINDOWS.map((r) => (
              <Link
                key={r}
                href={`?range=${r}`}
                className={`day-pill`}
                data-active={r === range ? "true" : "false"}
                scroll={false}
              >
                <span className="d">{USAGE_RANGE_LABELS[r].en}</span>
                <span className="n">{USAGE_RANGE_LABELS[r].zh}</span>
              </Link>
            ))}
          </div>
        </nav>

        {/* Hero grid: total spend + monthly cap / sparkline on the left,
            token mix + api-calls tile on the right. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr",
            gap: 18,
            marginTop: 16,
          }}
        >
          <div
            style={{
              background: "var(--bg-1)",
              border: "1px solid var(--border-1)",
              padding: "20px 24px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--fg-3)",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    marginBottom: 6,
                  }}
                >
                  {zh ? "总花费" : "total spend"} ·{" "}
                  {USAGE_RANGE_LABELS[range].en}
                </div>
                <CostBig amount={selected.costUsd} />
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--fg-3)",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  {zh ? "月度预算" : "monthly cap"}
                </div>
                <div
                  style={{
                    fontSize: 20,
                    color: "var(--fg-1)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  ${MONTHLY_CAP_USD.toFixed(2)}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color:
                      usedPct > 85
                        ? "var(--accent-red)"
                        : usedPct > 60
                          ? "var(--accent-orange)"
                          : "var(--accent-green)",
                    marginTop: 2,
                  }}
                >
                  {usedPct}% {zh ? "已用" : "used"}
                </div>
              </div>
            </div>
            <div className="progress" style={{ marginTop: 14 }}>
              <div
                className={`fill ${usedPct > 85 ? "warn" : ""}`}
                style={{ width: `${usedPct}%` }}
              />
            </div>

            {/* Daily-spend sparkline */}
            <div
              style={{
                marginTop: 20,
                borderTop: "1px dashed var(--border-1)",
                paddingTop: 12,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "var(--fg-3)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: 8,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>{zh ? "近 30 日" : "30-day daily spend"}</span>
                <span style={{ color: "var(--accent-green)" }}>
                  ${daily.reduce((a, d) => a + d.spend, 0).toFixed(2)}
                </span>
              </div>
              <div style={{ height: 72, position: "relative" }}>
                <svg
                  width="100%"
                  height="72"
                  viewBox="0 0 300 72"
                  preserveAspectRatio="none"
                >
                  {daily.map((d, i) => {
                    const h = Math.max(1, (d.spend / peakDaily) * 62);
                    const x = (i / Math.max(1, daily.length)) * 300;
                    const w = 300 / Math.max(1, daily.length) - 1;
                    const isLast = i === daily.length - 1;
                    return (
                      <rect
                        key={d.date}
                        x={x}
                        y={72 - h}
                        width={Math.max(1, w)}
                        height={h}
                        fill={
                          isLast
                            ? "var(--accent-orange)"
                            : "var(--accent-green)"
                        }
                        opacity={isLast ? 1 : 0.7}
                      >
                        <title>{`${d.date} · $${d.spend.toFixed(4)} · ${d.calls} calls`}</title>
                      </rect>
                    );
                  })}
                </svg>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 9.5,
                  color: "var(--fg-3)",
                  fontFamily: "var(--font-mono)",
                  marginTop: 4,
                }}
              >
                {daily.length > 0 && (
                  <>
                    <span>{formatUsageShortDate(daily[0].date)}</span>
                    {daily.length > 10 && (
                      <span>
                        {formatUsageShortDate(
                          daily[Math.floor(daily.length / 2)].date,
                        )}
                      </span>
                    )}
                    <span>
                      {formatUsageShortDate(daily[daily.length - 1].date)}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateRows: "1fr 1fr",
              gap: 10,
            }}
          >
            <Tile
              labelEn="api calls"
              labelZh="调用次数"
              value={formatUsageCount(selected.calls)}
              sub={USAGE_RANGE_LABELS[range].en}
              color="var(--fg-0)"
            />
            <TokenMixTile
              inputPct={inputPct}
              outputPct={outputPct}
              inputTokens={selected.inputTokens}
              outputTokens={selected.outputTokens}
              zh={zh}
            />
          </div>
        </div>

        {/* Quick totals across windows */}
        {today && week && month && all && (
          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 10,
            }}
          >
            <MiniSpend
              label={usageRangeLabel("today", usageLocale)}
              totals={today}
            />
            <MiniSpend
              label={usageRangeLabel("week", usageLocale)}
              totals={week}
            />
            <MiniSpend
              label={usageRangeLabel("month", usageLocale)}
              totals={month}
            />
            <MiniSpend
              label={usageRangeLabel("all", usageLocale)}
              totals={all}
            />
          </div>
        )}

        <UsageBreakdownTables
          byTask={usage.byTask}
          byModel={usage.byModel}
          recent={usage.recentCalls}
          zh={zh}
          timeLocale={zh ? "zh-CN" : "en-US"}
        />
      </main>
    </ViewShell>
  );
}

function CostBig({ amount }: { amount: number }) {
  const whole = Math.floor(amount);
  const cents = (amount - whole).toFixed(4).slice(2); // "0.1234" -> "1234"
  return (
    <div className="cost-big">
      <span className="cur">USD</span>
      {whole.toLocaleString()}
      <span className="cents">.{cents}</span>
    </div>
  );
}

function Tile({
  labelEn,
  labelZh,
  value,
  sub,
  color,
}: {
  labelEn: string;
  labelZh: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="tile">
      <div className="t-lbl">
        <span>
          {labelEn}
          <span className="cn">{labelZh}</span>
        </span>
      </div>
      <div className="t-val" style={{ color }}>
        {value}
      </div>
      {sub && <div className="t-sub">{sub}</div>}
    </div>
  );
}

function TokenMixTile({
  inputPct,
  outputPct,
  inputTokens,
  outputTokens,
  zh,
}: {
  inputPct: number;
  outputPct: number;
  inputTokens: number;
  outputTokens: number;
  zh: boolean;
}) {
  return (
    <div className="tile">
      <div className="t-lbl">
        <span>
          token mix<span className="cn">token 构成</span>
        </span>
      </div>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 11,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span className="muted" style={{ color: "var(--fg-3)" }}>
            {zh ? "输入" : "input"}
          </span>
          <span
            style={{
              color: "var(--fg-0)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {formatUsageTokens(inputTokens)}
          </span>
        </div>
        <div className="hbar">
          <div className="track">
            <div
              className="fill"
              style={{ width: `${inputPct}%`, background: "var(--accent-blue)" }}
            />
          </div>
          <span className="num">{inputPct}%</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span className="muted" style={{ color: "var(--fg-3)" }}>
            {zh ? "输出" : "output"}
          </span>
          <span
            style={{
              color: "var(--fg-0)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {formatUsageTokens(outputTokens)}
          </span>
        </div>
        <div className="hbar">
          <div className="track">
            <div
              className="fill"
              style={{
                width: `${outputPct}%`,
                background: "var(--accent-orange)",
              }}
            />
          </div>
          <span className="num">{outputPct}%</span>
        </div>
      </div>
    </div>
  );
}

function MiniSpend({ label, totals }: { label: string; totals: WindowTotals }) {
  return (
    <div
      style={{
        background: "var(--bg-0)",
        border: "1px solid var(--border-1)",
        padding: "10px 14px",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--fg-3)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          color: "var(--accent-green)",
          fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums",
          marginTop: 4,
        }}
      >
        ${totals.costUsd.toFixed(4)}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "var(--fg-3)",
          marginTop: 2,
        }}
      >
        {totals.calls} calls · {formatUsageTokens(totals.inputTokens)} in
      </div>
    </div>
  );
}
