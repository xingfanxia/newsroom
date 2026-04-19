import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { getLiveSources, liveSourcesByGroup } from "@/lib/sources/live";
import { getPulseData, getRadarStats } from "@/lib/shell/dashboard-stats";
import { SourcesViewToggle, type SourcesView } from "./_view-toggle";

export const dynamic = "force-dynamic";

const GROUP_ORDER = [
  "vendor-official",
  "media",
  "newsletter",
  "research",
  "social",
  "product",
  "podcast",
  "policy",
  "market",
] as const;

const GROUP_LABELS: Record<string, { en: string; zh: string }> = {
  "vendor-official": { en: "vendor official", zh: "官网" },
  media: { en: "media", zh: "媒体" },
  newsletter: { en: "newsletter", zh: "通讯" },
  research: { en: "research", zh: "研究" },
  social: { en: "social", zh: "社交" },
  product: { en: "product", zh: "产品" },
  podcast: { en: "podcast", zh: "播客" },
  policy: { en: "policy", zh: "政策" },
  market: { en: "market", zh: "市场" },
};

export default async function SourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const view: SourcesView = sp.view === "cards" ? "cards" : "table";

  const [live, stats, pulse] = await Promise.all([
    getLiveSources(),
    getRadarStats().catch(() => ({
      items_today: 0, items_p1: 0, items_featured: 0, tracked_sources: 0,
    })),
    getPulseData().catch(() => []),
  ]);

  const totalItems = live.reduce((a, b) => a + b.health.totalItemsCount, 0);
  const okCount = live.filter((s) => s.health.status === "ok").length;
  const errorCount = live.filter((s) => s.health.status === "error").length;
  const byGroup = liveSourcesByGroup(live);

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{ tracked_sources: stats.tracked_sources, signal_ratio: 0.72 }}
      pulse={pulse}
      crumb="~/sources"
      cmd={view === "cards" ? "ls -l sources/" : "cat sources.tsv | column -t"}
    >
      <main className="main">
        <PageHead
          en="sources"
          cjk="信源"
          count={live.length}
          countLabel="feeds"
          extra={
            <span>
              <span style={{ color: "var(--accent-green)" }}>{okCount}</span> ok{" · "}
              <span style={{ color: "var(--accent-red)" }}>{errorCount}</span> error{" · "}
              <span style={{ color: "var(--fg-1)" }}>{totalItems.toLocaleString()}</span>{" items"}
            </span>
          }
        />

        <div
          className="filters"
          style={{ marginBottom: 18, justifyContent: "flex-end" }}
        >
          <SourcesViewToggle view={view} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {GROUP_ORDER.map((g) => {
            const itemsInGroup = byGroup.get(g);
            if (!itemsInGroup || itemsInGroup.length === 0) return null;
            const label = GROUP_LABELS[g];
            return (
              <section key={g}>
                <div
                  className="daybreak"
                  style={{
                    padding: "8px 0 10px",
                    justifyContent: "flex-start",
                    gap: 10,
                  }}
                >
                  <span className="date">{label.en}</span>
                  <span className="cn">{label.zh}</span>
                  <span style={{ color: "var(--fg-3)", fontSize: 10 }}>
                    {itemsInGroup.length}
                  </span>
                </div>

                {view === "cards" ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                      gap: 10,
                    }}
                  >
                    {itemsInGroup.map((s) => (
                      <div key={s.id} className="panel" style={{ padding: 0 }}>
                        <div className="hd">
                          <span className="t" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.id}
                          </span>
                          <span
                            className={
                              s.health.status === "error" ? "tier-p1" : "tier-f"
                            }
                            style={{
                              fontSize: 10,
                              padding: "1px 6px",
                              borderRadius: 2,
                              color:
                                s.health.status === "error"
                                  ? "var(--accent-red)"
                                  : s.health.status === "ok"
                                    ? "var(--accent-green)"
                                    : "var(--fg-3)",
                              background:
                                s.health.status === "error"
                                  ? "rgba(248,81,73,0.08)"
                                  : s.health.status === "ok"
                                    ? "rgba(63,185,80,0.06)"
                                    : "var(--bg-2)",
                              border:
                                s.health.status === "error"
                                  ? "1px solid rgba(248,81,73,0.25)"
                                  : s.health.status === "ok"
                                    ? "1px solid rgba(63,185,80,0.2)"
                                    : "1px solid var(--border-1)",
                            }}
                          >
                            {s.health.status}
                          </span>
                        </div>
                        <div
                          className="bd"
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            fontSize: 11.5,
                          }}
                        >
                          <div
                            style={{
                              fontFamily:
                                locale === "zh"
                                  ? "var(--font-sans-cjk)"
                                  : "var(--font-mono)",
                              color: "var(--fg-1)",
                            }}
                          >
                            {locale === "zh" ? s.name.zh : s.name.en}
                          </div>
                          <div style={{ color: "var(--fg-3)", fontSize: 10.5 }}>
                            {s.kind} · {s.locale} · {s.cadence}
                          </div>
                          <div
                            style={{
                              color: "var(--fg-2)",
                              fontFamily: "var(--font-mono)",
                              fontVariantNumeric: "tabular-nums",
                              fontSize: 10.5,
                            }}
                          >
                            <span style={{ color: "var(--fg-0)" }}>
                              {s.health.totalItemsCount}
                            </span>{" "}
                            items collected
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="panel">
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "var(--bg-2)" }}>
                          <Th>id</Th>
                          <Th>kind</Th>
                          <Th>locale</Th>
                          <Th>cadence</Th>
                          <Th align="right">items</Th>
                          <Th align="right">status</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemsInGroup.map((s) => (
                          <tr
                            key={s.id}
                            style={{ borderTop: "1px solid var(--border-1)" }}
                          >
                            <td style={cellStyle}>
                              <div
                                style={{
                                  color: "var(--fg-0)",
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 12,
                                }}
                              >
                                {s.id}
                              </div>
                              <div
                                style={{
                                  color: "var(--fg-3)",
                                  fontSize: 11,
                                  fontFamily:
                                    locale === "zh"
                                      ? "var(--font-sans-cjk)"
                                      : "var(--font-mono)",
                                }}
                              >
                                {locale === "zh" ? s.name.zh : s.name.en}
                              </div>
                            </td>
                            <td style={cellStyle}>{s.kind}</td>
                            <td style={cellStyle}>{s.locale}</td>
                            <td style={cellStyle}>{s.cadence}</td>
                            <td style={{ ...cellStyle, textAlign: "right" }}>
                              <span
                                style={{
                                  color: "var(--fg-0)",
                                  fontVariantNumeric: "tabular-nums",
                                }}
                              >
                                {s.health.totalItemsCount}
                              </span>
                            </td>
                            <td style={{ ...cellStyle, textAlign: "right" }}>
                              <span
                                className={
                                  s.health.status === "error" ? "tier-p1" : "tier-f"
                                }
                                style={{
                                  fontSize: 10,
                                  padding: "2px 6px",
                                  borderRadius: 2,
                                  background:
                                    s.health.status === "error"
                                      ? "rgba(248,81,73,0.12)"
                                      : s.health.status === "ok"
                                        ? "rgba(63,185,80,0.08)"
                                        : "var(--bg-2)",
                                  color:
                                    s.health.status === "error"
                                      ? "var(--accent-red)"
                                      : s.health.status === "ok"
                                        ? "var(--accent-green)"
                                        : "var(--fg-3)",
                                }}
                              >
                                {s.health.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </main>
    </ViewShell>
  );
}

const cellStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 12,
  color: "var(--fg-2)",
  fontFamily: "var(--font-mono)",
  verticalAlign: "middle",
};

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        padding: "8px 12px",
        textAlign: align ?? "left",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        color: "var(--fg-3)",
        fontWeight: 500,
        borderBottom: "1px solid var(--border-1)",
      }}
    >
      {children}
    </th>
  );
}
