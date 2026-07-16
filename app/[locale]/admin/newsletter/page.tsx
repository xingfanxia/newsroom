import { setRequestLocale } from "next-intl/server";
import { AdminSectionHeader as SectionHeader } from "@/components/admin/section-header";
import { AdminTableFrame } from "@/components/admin/table-frame";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { getNewsletterAdminStats } from "@/lib/email/admin-stats";
import { getShellChromeData } from "@/lib/shell/chrome-data";
import { formatCoarseRelativeTime } from "@/lib/time/relative";
import { appLocaleFromParam } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * /admin/newsletter — subscriber counts + email-send tracking over the
 * private newsletter_subscribers / newsletter_email_sends tables.
 *
 *  - 4-tile hero (active / pending / churned / delivered)
 *  - per-period send ledger (kind, sent, failed, last send time)
 *  - recent subscribers (status, kinds, confirmed)
 */
export default async function AdminNewsletterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = appLocaleFromParam(locale);
  setRequestLocale(appLocale);
  const zh = appLocale === "zh";

  const [stats, chrome] = await Promise.all([
    getNewsletterAdminStats(),
    getShellChromeData(),
  ]);

  const churned =
    stats.subscribers.unsubscribed +
    stats.subscribers.bounced +
    stats.subscribers.complained;

  const kindLabel = (kind: string) =>
    kind === "daily_digest" ? (zh ? "日报" : "digest") : zh ? "精选" : "featured";

  return (
    <ViewShell
      locale={appLocale}
      stats={chrome.topBarStats}
      crumb="~/admin/newsletter"
      cmd="sqlite3 newsroom.db 'SELECT count(*) FROM newsletter_subscribers'"
    >
      <main className="main">
        <PageHead
          en="newsletter"
          cjk="邮件订阅"
          live={`${stats.subscribers.active} active`}
          extra={
            <span>
              {zh
                ? "订阅者与每日邮件发送追踪"
                : "subscribers · daily email delivery tracking"}
            </span>
          }
          policyLabel={`${stats.totals.failed ? "⚠ " : ""}${stats.totals.failed} failed`}
        />

        {/* hero tiles */}
        <div className="tiles">
          <div className="tile">
            <div className="t-lbl">
              <span>
                active<span className="cn">已确认订阅</span>
              </span>
            </div>
            <div className="t-val" style={{ color: "var(--accent-green)" }}>
              {stats.subscribers.active}
            </div>
            <div className="t-sub">
              <span>
                日报 {stats.subscribers.activeWantsDigest} · 精选{" "}
                {stats.subscribers.activeWantsFeatured}
              </span>
            </div>
          </div>
          <div className="tile">
            <div className="t-lbl">
              <span>
                pending<span className="cn">待确认</span>
              </span>
            </div>
            <div className="t-val">{stats.subscribers.pending}</div>
            <div className="t-sub">
              <span>{zh ? "双重确认未点击" : "double opt-in unclicked"}</span>
            </div>
          </div>
          <div className="tile">
            <div className="t-lbl">
              <span>
                churned<span className="cn">退订/退信</span>
              </span>
            </div>
            <div
              className="t-val"
              style={{
                color: churned > 0 ? "var(--accent-orange)" : "var(--fg-0)",
              }}
            >
              {churned}
            </div>
            <div className="t-sub">
              <span>
                {stats.subscribers.unsubscribed} unsub ·{" "}
                {stats.subscribers.bounced + stats.subscribers.complained}{" "}
                bounce
              </span>
            </div>
          </div>
          <div className="tile">
            <div className="t-lbl">
              <span>
                delivered<span className="cn">累计送达</span>
              </span>
            </div>
            <div className="t-val">{stats.totals.delivered}</div>
            <div className="t-sub">
              {stats.totals.failed > 0 ? (
                <span className="down">{stats.totals.failed} failed</span>
              ) : (
                <span className="up">● no failures</span>
              )}
            </div>
          </div>
        </div>

        {/* send ledger */}
        <SectionHeader
          title={zh ? "发送记录 · 按期" : "send ledger · by period"}
          meta={`${stats.sends.length} rows`}
        />
        <AdminTableFrame>
          <table className="dt">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>{zh ? "日期" : "period"}</th>
                <th style={{ textAlign: "left" }}>{zh ? "类型" : "kind"}</th>
                <th className="right">{zh ? "送达" : "sent"}</th>
                <th className="right">{zh ? "失败" : "failed"}</th>
                <th className="right">{zh ? "时间" : "last send"}</th>
              </tr>
            </thead>
            <tbody>
              {stats.sends.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: "var(--fg-2)", padding: 12 }}>
                    {zh
                      ? "还没有发送记录 — 首封邮件在下一个 13:40。"
                      : "No sends yet — the first email goes out at the next 13:40."}
                  </td>
                </tr>
              ) : (
                stats.sends.map((row) => (
                  <tr key={`${row.periodKey}-${row.kind}`}>
                    <td style={{ fontFamily: "var(--font-mono)" }}>{row.periodKey}</td>
                    <td>{kindLabel(row.kind)}</td>
                    <td style={{ textAlign: "right" }}>{row.sent}</td>
                    <td
                      style={{
                        textAlign: "right",
                        color:
                          row.failed > 0 ? "var(--accent-red)" : "var(--fg-2)",
                      }}
                    >
                      {row.failed}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--fg-2)" }}>
                      {row.lastSentAt
                        ? formatCoarseRelativeTime(row.lastSentAt)
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </AdminTableFrame>

        {/* recent subscribers */}
        <SectionHeader
          title={zh ? "最新订阅者" : "recent subscribers"}
          meta={`${stats.subscribers.total} total`}
          extraStyle={{ marginTop: 24 }}
        />
        <AdminTableFrame>
          <table className="dt">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>email</th>
                <th style={{ textAlign: "left" }}>{zh ? "状态" : "status"}</th>
                <th style={{ textAlign: "left" }}>{zh ? "订阅内容" : "kinds"}</th>
                <th className="right">{zh ? "加入" : "joined"}</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentSubscribers.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ color: "var(--fg-2)", padding: 12 }}>
                    {zh ? "还没有订阅者。" : "No subscribers yet."}
                  </td>
                </tr>
              ) : (
                stats.recentSubscribers.map((s) => (
                  <tr key={s.email}>
                    <td style={{ fontFamily: "var(--font-mono)" }}>{s.email}</td>
                    <td>
                      <span
                        style={{
                          color:
                            s.status === "active"
                              ? "var(--accent-green)"
                              : s.status === "pending"
                                ? "var(--accent-orange)"
                                : "var(--fg-2)",
                        }}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td style={{ color: "var(--fg-2)" }}>
                      {[
                        s.wantsDailyDigest ? (zh ? "日报" : "digest") : null,
                        s.wantsDailyFeatured ? (zh ? "精选" : "featured") : null,
                      ]
                        .filter(Boolean)
                        .join(" + ") || "—"}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--fg-2)" }}>
                      {formatCoarseRelativeTime(s.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </AdminTableFrame>
      </main>
    </ViewShell>
  );
}
