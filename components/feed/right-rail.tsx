"use client";
import { RadarWidget, type RadarStats } from "./radar-widget";
import { useTweaks } from "@/hooks/use-tweaks";

export type WatchlistEntry = { q: string; hits: number; delta: number };
export type TopicEntry = { tag: string; count: number; hot?: boolean };

/**
 * Right rail — radar widget + watchlist + topics cloud + curation policy
 * summary. Entire rail hides under 1200px per terminal.css.
 */
export function RightRail({
  stats,
  watchlist,
  topics,
  policyVersion = "v1",
  lastIterAt,
}: {
  stats: RadarStats;
  watchlist: WatchlistEntry[];
  topics: TopicEntry[];
  policyVersion?: string;
  lastIterAt?: string;
}) {
  const { tweaks } = useTweaks();
  const lang = tweaks.language;
  const zh = lang === "zh";

  return (
    <aside className="rail-r scroll-dark">
      {tweaks.showRadar && <RadarWidget stats={stats} />}

      <div className="panel">
        <div className="hd">
          <span className="t">{zh ? "监控" : "watchlist"}</span>
          <span className="more">+ {zh ? "添加" : "add"}</span>
        </div>
        <div className="bd">
          {watchlist.length === 0 && (
            <div
              style={{
                color: "var(--fg-3)",
                fontSize: 11,
                fontStyle: "italic",
                padding: "6px 0",
              }}
            >
              {zh ? "暂无关键词" : "no terms yet"}
            </div>
          )}
          {watchlist.map((w) => (
            <div key={w.q} className="watch-row">
              <span className="sym">▸</span>
              <span className="q">{w.q}</span>
              <span className="hits">{w.hits}</span>
              <span className={`d ${w.delta > 0 ? "up" : "z"}`}>
                {w.delta > 0 ? `+${w.delta}` : "—"}
              </span>
            </div>
          ))}
          <div className="watch-add">
            <span className="plus">+</span>{" "}
            {zh ? "监控新关键词" : "watch new term"}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="hd">
          <span className="t">{zh ? "主题 · 24h" : "topics · 24h"}</span>
          <span className="more">{zh ? "全部" : "all"}</span>
        </div>
        <div className="bd">
          <div className="topics">
            {topics.map((t) => (
              <span key={t.tag} className={`topic ${t.hot ? "hot" : ""}`}>
                <span>#{t.tag}</span>
                <span className="n">{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="hd">
          <span className="t">{zh ? "精选策略" : "curation policy"}</span>
          <a className="more" href="/admin/policy">
            {policyVersion}
          </a>
        </div>
        <div
          className="bd"
          style={{ fontSize: 11.5, lineHeight: 1.7, color: "var(--fg-2)" }}
        >
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: "var(--accent-orange)", fontWeight: 700 }}>
              P1
            </span>{" "}
            <span style={{ color: "var(--fg-3)" }}>
              HKR ≥ 85 ·{" "}
              {zh ? "重大发布 · 第一方" : "major release · first-party"}
            </span>
          </div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: "var(--accent-green)", fontWeight: 700 }}>
              FEATURED
            </span>{" "}
            <span style={{ color: "var(--fg-3)" }}>
              HKR 70–84 · {zh ? "已验证信号" : "verified signal"}
            </span>
          </div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: "var(--fg-3)", fontWeight: 700 }}>DROP</span>{" "}
            <span style={{ color: "var(--fg-3)" }}>
              HKR &lt; 70 · {zh ? "猜测 · 噪音" : "speculation · noise"}
            </span>
          </div>
          {lastIterAt && (
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: "1px dashed var(--border-1)",
                color: "var(--fg-3)",
              }}
            >
              <span style={{ color: "var(--fg-2)" }}>
                {zh ? "最近迭代" : "last iter"}:
              </span>{" "}
              {lastIterAt}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
