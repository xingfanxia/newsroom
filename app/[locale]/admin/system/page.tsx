import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { getRadarStats } from "@/lib/shell/dashboard-stats";
import { getSystemSnapshot } from "@/lib/shell/system-stats";

export const dynamic = "force-dynamic";

/**
 * /admin/system — infrastructure observability view matching the design
 * demo. Renders:
 *
 *  - 4-tile hero (services up / queue depth / p95 / errors 24h)
 *  - banner when any enabled source is in error status
 *  - service grid from `source_health` (one card per enabled source)
 *  - pipeline queues (normalize / enrich / commentary / score depths)
 *  - cron schedule mirrored from `vercel.json`
 *  - 24h error log from `source_health.last_error`
 *
 * Spend tables moved to /admin/usage in s8 — if you're looking for LLM
 * cost, that's the dedicated view now.
 */
export default async function SystemPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const zh = locale === "zh";

  const [snap, stats] = await Promise.all([
    getSystemSnapshot(),
    getRadarStats().catch(() => ({
      items_today: 0,
      items_p1: 0,
      items_featured: 0,
      tracked_sources: 0,
    })),
  ]);

  const totalSvc = snap.services.length;
  const healthy = snap.counts.healthy;
  const degraded = snap.counts.degraded;
  const errorCount = snap.counts.error;
  const queueDepthTotal = snap.queues.reduce((a, q) => a + q.depth, 0);
  const recentErrors24h = snap.errors.length;

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{ tracked_sources: stats.tracked_sources, signal_ratio: 0.72 }}
      crumb="~/admin/system"
      cmd="htop -u ax-radar && tail -f /var/log/ax/*.log"
    >
      <main className="main">
        <PageHead
          en="system"
          cjk="系统"
          live={`${healthy}/${totalSvc} healthy`}
          extra={
            <span>
              {zh ? "worker 队列、调度与错误日志" : "worker queues · schedules · error log"}
            </span>
          }
          policyLabel={`${errorCount ? "⚠ " : ""}${errorCount} err`}
        />

        {(errorCount > 0 || degraded > 0) && (
          <div className="banner warn">
            <span className="ic">WARN</span>
            <span className="msg">
              <b>
                {errorCount} {zh ? "个信源报错" : "source(s) errored"}
              </b>
              {degraded > 0 && (
                <>
                  {" · "}
                  {degraded} {zh ? "降级中" : "degraded"}
                </>
              )}
              {zh
                ? " — 查看下方服务网格与错误日志排查。"
                : " — see the service grid + error log below to triage."}
            </span>
          </div>
        )}

        {/* hero tiles */}
        <div className="tiles">
          <div className="tile">
            <div className="t-lbl">
              <span>
                services up<span className="cn">服务在线</span>
              </span>
            </div>
            <div
              className="t-val"
              style={{
                color: errorCount > 0 ? "var(--accent-red)" : "var(--fg-0)",
              }}
            >
              {healthy}/{totalSvc}
            </div>
            <div className="t-sub">
              <span className="up">● healthy</span>
              {degraded > 0 && <span className="down">{degraded} degraded</span>}
              {errorCount > 0 && <span className="down">{errorCount} error</span>}
            </div>
          </div>
          <div className="tile">
            <div className="t-lbl">
              <span>
                queue depth<span className="cn">队列深度</span>
              </span>
            </div>
            <div className="t-val">{queueDepthTotal}</div>
            <div className="t-sub">
              <span>
                {zh ? "跨" : "across"} {snap.queues.length}{" "}
                {zh ? "条队列" : "queues"}
              </span>
            </div>
          </div>
          <div className="tile">
            <div className="t-lbl">
              <span>
                errors · 24h<span className="cn">24h 错误</span>
              </span>
            </div>
            <div
              className="t-val"
              style={{
                color:
                  recentErrors24h > 5
                    ? "var(--accent-red)"
                    : recentErrors24h > 0
                      ? "var(--accent-orange)"
                      : "var(--accent-green)",
              }}
            >
              {recentErrors24h}
            </div>
            <div className="t-sub">
              <span>{zh ? "来自启用的信源" : "from enabled sources"}</span>
            </div>
          </div>
          <div className="tile">
            <div className="t-lbl">
              <span>
                cron jobs<span className="cn">定时</span>
              </span>
            </div>
            <div className="t-val">{snap.cron.length}</div>
            <div className="t-sub">
              <span>vercel.json</span>
            </div>
          </div>
        </div>

        {/* services grid */}
        <SectionHeader
          title={zh ? "服务 · services" : "services · 服务"}
          meta={`${totalSvc}`}
        />
        <div className="svc-grid">
          {snap.services.map((s) => (
            <div key={s.id} className={`svc-card ${s.status}`}>
              <div className="name">
                <span className={`sd ${s.status}`} />
                {s.name}
              </div>
              <div className="ver">{s.version}</div>
              <div className="meta">
                <span>up {s.uptime}</span>
              </div>
              {s.note && <div className="note">⚠ {s.note}</div>}
            </div>
          ))}
        </div>

        {/* queues + cron + errors */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 18,
            marginTop: 18,
          }}
        >
          <div>
            <SectionHeader title={zh ? "队列 · queues" : "queues · 队列"} />
            <div
              style={{
                background: "var(--bg-1)",
                border: "1px solid var(--border-1)",
              }}
            >
              <table className="dt">
                <thead>
                  <tr>
                    <th>{zh ? "队列" : "queue"}</th>
                    <th className="right">{zh ? "深度" : "depth"}</th>
                    <th className="right">{zh ? "速率" : "rate"}</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.queues.map((q) => (
                    <tr key={q.name}>
                      <td
                        style={{
                          color: "var(--fg-0)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {q.name}
                      </td>
                      <td
                        className="right"
                        style={{
                          color:
                            q.depth > 500
                              ? "var(--accent-orange)"
                              : "var(--fg-1)",
                          fontWeight: 500,
                        }}
                      >
                        {q.depth.toLocaleString()}
                      </td>
                      <td className="right">
                        <span className="muted">{q.rate}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <SectionHeader
              title={zh ? "定时 · cron" : "cron · 定时"}
              extraStyle={{ marginTop: 16 }}
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
                    <th>{zh ? "任务" : "job"}</th>
                    <th>{zh ? "调度" : "schedule"}</th>
                    <th>{zh ? "节奏" : "cadence"}</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.cron.map((c) => (
                    <tr key={c.name}>
                      <td
                        style={{
                          color: "var(--fg-0)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        <span className="sd healthy" />
                        {c.name}
                      </td>
                      <td>
                        <code
                          style={{
                            color: "var(--accent-blue)",
                            fontSize: 10.5,
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {c.schedule}
                        </code>
                      </td>
                      <td>
                        <span className="muted">{c.next}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <SectionHeader
              title={zh ? "24h 错误" : "errors · 24h"}
              meta={
                snap.errors.length > 0
                  ? `${snap.errors.filter((e) => e.level === "error").length} err · ${snap.errors.filter((e) => e.level === "warn").length} warn`
                  : "—"
              }
              metaColor={
                snap.errors.length > 0 ? "var(--accent-red)" : "var(--fg-3)"
              }
            />
            <div
              style={{
                background: "var(--bg-0)",
                border: "1px solid var(--border-1)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                maxHeight: 420,
                overflow: "auto",
              }}
            >
              {snap.errors.length === 0 ? (
                <div
                  style={{
                    padding: 18,
                    color: "var(--fg-3)",
                    fontSize: 11,
                    textAlign: "center",
                  }}
                >
                  {zh ? "无错误 · 全部启用信源正常" : "no errors — all enabled sources green"}
                </div>
              ) : (
                snap.errors.map((e, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "8px 12px",
                      borderBottom: "1px dashed var(--border-1)",
                      display: "grid",
                      gridTemplateColumns: "auto auto 1fr",
                      gap: 10,
                      alignItems: "baseline",
                    }}
                  >
                    <span style={{ color: "var(--fg-3)", fontSize: 10.5 }}>
                      {e.t}
                    </span>
                    <span
                      style={{
                        color:
                          e.level === "error"
                            ? "var(--accent-red)"
                            : e.level === "warn"
                              ? "var(--accent-orange)"
                              : "var(--accent-blue)",
                        fontSize: 10,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      [{e.level}]
                    </span>
                    <span style={{ color: "var(--fg-1)" }}>
                      <span style={{ color: "var(--accent-blue)" }}>
                        {e.svc}
                      </span>{" "}
                      <span style={{ color: "var(--fg-3)" }}>{e.code}</span> —{" "}
                      {e.msg}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div
              style={{
                padding: 10,
                fontSize: 10.5,
                color: "var(--fg-3)",
                display: "flex",
                gap: 12,
                alignItems: "center",
              }}
            >
              <span style={{ color: "var(--accent-green)" }}>
                ● {zh ? "实时监控 source_health" : "tailing source_health"}
              </span>
              <span style={{ marginLeft: "auto" }}>
                <a
                  style={{
                    color: "var(--accent-blue)",
                    textDecoration: "none",
                  }}
                  href={`/${locale}/admin/usage`}
                >
                  {zh ? "→ 用量仪表盘" : "→ usage dashboard"}
                </a>
              </span>
            </div>
          </div>
        </div>
      </main>
    </ViewShell>
  );
}

function SectionHeader({
  title,
  meta,
  metaColor,
  extraStyle,
}: {
  title: string;
  meta?: string;
  metaColor?: string;
  extraStyle?: React.CSSProperties;
}) {
  return (
    <h3
      style={{
        fontSize: 11,
        color: "var(--fg-3)",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        margin: "16px 0 8px",
        fontWeight: 500,
        display: "flex",
        justifyContent: "space-between",
        ...extraStyle,
      }}
    >
      <span>{title}</span>
      {meta && (
        <span style={{ color: metaColor ?? "var(--fg-0)", fontWeight: 500 }}>
          {meta}
        </span>
      )}
    </h3>
  );
}
