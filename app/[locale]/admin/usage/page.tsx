import Link from "next/link";
import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { getRadarStats } from "@/lib/shell/dashboard-stats";
import {
  totalsByWindow,
  breakdownByTask,
  breakdownByModel,
  recentCalls,
  dailySpend,
  type WindowTotals,
} from "@/lib/llm/stats";

export const dynamic = "force-dynamic";

const RANGES = ["today", "week", "month"] as const;
type Range = (typeof RANGES)[number];

const RANGE_LABEL: Record<Range, { en: string; zh: string }> = {
  today: { en: "today", zh: "今日" },
  week: { en: "past 7d", zh: "近 7 天" },
  month: { en: "past 30d", zh: "近 30 天" },
};

const MONTHLY_CAP_USD = Number(process.env.USAGE_MONTHLY_CAP_USD ?? 500);

/**
 * /admin/usage — full LLM-spend view matching the design demo.
 *
 * Rendered server-side with `?range=today|week|month` driving the selected
 * window. All data backed by the real llm_usage table: totals for today/
 * week/month, cost by task with share %, cost by model, 30d daily-spend
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
  setRequestLocale(locale);
  const zh = locale === "zh";
  const range: Range = (RANGES as readonly string[]).includes(sp.range ?? "")
    ? (sp.range as Range)
    : "week";

  const [selected, today, week, month, byTask, byModel, recent, daily, stats] =
    await Promise.all([
      totalsByWindow(range),
      totalsByWindow("today").catch(() => null),
      totalsByWindow("week").catch(() => null),
      totalsByWindow("month").catch(() => null),
      breakdownByTask(range).catch(() => []),
      breakdownByModel(range).catch(() => []),
      recentCalls(25).catch(() => []),
      dailySpend(30).catch(() => []),
      getRadarStats().catch(() => ({
        items_today: 0,
        items_p1: 0,
        items_featured: 0,
        tracked_sources: 0,
      })),
    ]);

  const totalTaskCost = byTask.reduce((a, t) => a + t.costUsd, 0) || 1;
  const peakDaily = Math.max(1, ...daily.map((d) => d.spend));
  const usedPct = Math.min(
    100,
    Math.round(((month?.costUsd ?? 0) / MONTHLY_CAP_USD) * 100),
  );
  const tokMixTotal = selected.inputTokens + selected.outputTokens || 1;
  const inputPct = Math.round((selected.inputTokens / tokMixTotal) * 100);
  const outputPct = 100 - inputPct;

  const timeFmt = new Intl.DateTimeFormat(zh ? "zh-CN" : "en-US", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{ tracked_sources: stats.tracked_sources, signal_ratio: 0.72 }}
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
              {zh ? "监控窗口" : "window"} {RANGE_LABEL[range].en} ·{" "}
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
            {RANGES.map((r) => (
              <Link
                key={r}
                href={`?range=${r}`}
                className={`day-pill`}
                data-active={r === range ? "true" : "false"}
                scroll={false}
              >
                <span className="d">{RANGE_LABEL[r].en}</span>
                <span className="n">{RANGE_LABEL[r].zh}</span>
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
                  {zh ? "总花费" : "total spend"} · {RANGE_LABEL[range].en}
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
                    <span>{formatShortDate(daily[0].date)}</span>
                    {daily.length > 10 && (
                      <span>
                        {formatShortDate(daily[Math.floor(daily.length / 2)].date)}
                      </span>
                    )}
                    <span>{formatShortDate(daily[daily.length - 1].date)}</span>
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
              value={formatNumber(selected.calls)}
              sub={RANGE_LABEL[range].en}
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
        {today && week && month && (
          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 10,
            }}
          >
            <MiniSpend label={zh ? "今日" : "today"} totals={today} />
            <MiniSpend label={zh ? "近 7 天" : "7d"} totals={week} />
            <MiniSpend label={zh ? "近 30 天" : "30d"} totals={month} />
          </div>
        )}

        {/* Bottom grid — cost by task (with share bars) + cost by model
            stacked with recent-calls table. */}
        <div
          style={{
            marginTop: 18,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 18,
          }}
        >
          <div>
            <SectionHeader
              title={zh ? "按任务花费" : "cost by task"}
              meta={`$${byTask.reduce((a, t) => a + t.costUsd, 0).toFixed(2)}`}
            />
            <div
              style={{
                background: "var(--bg-1)",
                border: "1px solid var(--border-1)",
              }}
            >
              <table className="dt">
                <thead>
                  <tr>
                    <th>{zh ? "任务" : "task"}</th>
                    <th className="right">{zh ? "次数" : "calls"}</th>
                    <th className="right">{zh ? "输入" : "input"}</th>
                    <th className="right">{zh ? "输出" : "output"}</th>
                    <th className="right">{zh ? "花费" : "cost"}</th>
                    <th className="right">{zh ? "占比" : "share"}</th>
                  </tr>
                </thead>
                <tbody>
                  {byTask.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted" style={{ padding: 20 }}>
                        {zh ? "窗口内无活动" : "no activity in window"}
                      </td>
                    </tr>
                  ) : (
                    byTask.map((t) => {
                      const share = (t.costUsd / totalTaskCost) * 100;
                      return (
                        <tr key={t.task ?? "untagged"}>
                          <td
                            style={{
                              color: "var(--fg-0)",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {t.task ?? "untagged"}
                          </td>
                          <td className="right">{formatNumber(t.calls)}</td>
                          <td className="right">
                            <span className="muted">
                              {formatTokens(t.inputTokens)}
                            </span>
                          </td>
                          <td className="right">
                            <span className="muted">
                              {formatTokens(t.outputTokens)}
                            </span>
                          </td>
                          <td
                            className="right"
                            style={{ color: "var(--accent-orange)" }}
                          >
                            ${t.costUsd.toFixed(2)}
                          </td>
                          <td className="right">
                            <div className="hbar">
                              <div className="track">
                                <div
                                  className="fill"
                                  style={{ width: `${share}%` }}
                                />
                              </div>
                              <span className="num">{share.toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <SectionHeader title={zh ? "按模型花费" : "cost by model"} />
            <div
              style={{
                background: "var(--bg-1)",
                border: "1px solid var(--border-1)",
                marginBottom: 18,
              }}
            >
              <table className="dt">
                <thead>
                  <tr>
                    <th>{zh ? "模型" : "model"}</th>
                    <th>{zh ? "供应商" : "provider"}</th>
                    <th className="right">{zh ? "次数" : "calls"}</th>
                    <th className="right">{zh ? "花费" : "cost"}</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted" style={{ padding: 20 }}>
                        {zh ? "窗口内无活动" : "no activity in window"}
                      </td>
                    </tr>
                  ) : (
                    byModel.map((m) => (
                      <tr key={`${m.provider}/${m.model}`}>
                        <td
                          style={{
                            color: "var(--fg-0)",
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                          }}
                        >
                          {m.model}
                        </td>
                        <td>
                          <span className="muted">{m.provider}</span>
                        </td>
                        <td className="right">{formatNumber(m.calls)}</td>
                        <td
                          className="right"
                          style={{ color: "var(--accent-orange)" }}
                        >
                          ${m.costUsd.toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <SectionHeader
              title={zh ? "最近调用" : "recent calls"}
              meta={`${recent.length}`}
            />
            <div
              style={{
                background: "var(--bg-1)",
                border: "1px solid var(--border-1)",
                maxHeight: 360,
                overflow: "auto",
              }}
            >
              <table className="dt">
                <thead>
                  <tr>
                    <th>{zh ? "时间" : "time"}</th>
                    <th>{zh ? "任务" : "task"}</th>
                    <th className="right">in</th>
                    <th className="right">out</th>
                    <th className="right">dur</th>
                    <th className="right">{zh ? "花费" : "cost"}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted" style={{ padding: 20 }}>
                        {zh ? "无调用记录" : "no calls recorded yet"}
                      </td>
                    </tr>
                  ) : (
                    recent.map((c) => (
                      <tr key={c.id}>
                        <td className="muted" style={{ fontSize: 10.5 }}>
                          {timeFmt.format(c.createdAt)}
                        </td>
                        <td>
                          <span className={`pill-s ${taskPillColor(c.task)}`}>
                            {c.task ?? "—"}
                          </span>
                        </td>
                        <td className="right">
                          <span className="muted">
                            {formatNumber(c.inputTokens)}
                          </span>
                        </td>
                        <td className="right">
                          <span className="muted">
                            {formatNumber(c.outputTokens)}
                          </span>
                        </td>
                        <td className="right">
                          <span className="muted">
                            {c.durationMs
                              ? `${(c.durationMs / 1000).toFixed(1)}s`
                              : "—"}
                          </span>
                        </td>
                        <td
                          className="right"
                          style={{ color: "var(--accent-orange)" }}
                        >
                          {c.costUsd !== null
                            ? `$${c.costUsd.toFixed(4)}`
                            : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
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
            {formatTokens(inputTokens)}
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
            {formatTokens(outputTokens)}
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
        {totals.calls} calls · {formatTokens(totals.inputTokens)} in
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  meta,
}: {
  title: string;
  meta?: string;
}) {
  return (
    <h3
      style={{
        fontSize: 11,
        color: "var(--fg-3)",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        margin: "0 0 8px",
        fontWeight: 500,
        display: "flex",
        justifyContent: "space-between",
      }}
    >
      <span>{title}</span>
      {meta && <span style={{ color: "var(--fg-0)" }}>{meta}</span>}
    </h3>
  );
}

function taskPillColor(task: string | null): "g" | "b" | "o" | "r" | "" {
  if (task === "score") return "g";
  if (task === "enrich") return "b";
  if (task === "commentary") return "o";
  if (task === "embed") return "";
  if (task === "agent") return "r";
  return "";
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatNumber(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatShortDate(iso: string): string {
  const [, mm, dd] = iso.split("-");
  return `${mm}·${dd}`;
}
