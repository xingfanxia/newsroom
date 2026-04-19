"use client";
import { useEffect, useState } from "react";
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

      <WatchlistPanel fallback={watchlist} zh={zh} />



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

/**
 * Watchlist panel — hydrates from /api/tweaks on mount to pick up the user's
 * saved terms, falls back to the passed-in demo list. Edit mode lets the
 * user add/remove terms; save fires a single PATCH /api/tweaks {watchlist}.
 */
function WatchlistPanel({
  fallback,
  zh,
}: {
  fallback: WatchlistEntry[];
  zh: boolean;
}) {
  const [terms, setTerms] = useState<string[]>(() =>
    fallback.map((w) => w.q),
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tweaks", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        if (Array.isArray(body?.watchlist)) setTerms(body.watchlist);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (next: string[]) => {
    setBusy(true);
    try {
      await fetch("/api/tweaks", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watchlist: next }),
      });
    } finally {
      setBusy(false);
    }
  };

  const addTerm = () => {
    const v = draft.trim();
    if (!v) return;
    if (terms.includes(v)) {
      setDraft("");
      return;
    }
    const next = [...terms, v].slice(0, 24);
    setTerms(next);
    setDraft("");
    void save(next);
  };

  const remove = (q: string) => {
    const next = terms.filter((t) => t !== q);
    setTerms(next);
    void save(next);
  };

  return (
    <div className="panel">
      <div className="hd">
        <span className="t">{zh ? "监控" : "watchlist"}</span>
        <span
          className="more"
          role="button"
          onClick={() => setEditing((e) => !e)}
          style={{
            cursor: "pointer",
            color: editing ? "var(--accent-green)" : "var(--fg-3)",
          }}
        >
          {editing ? (zh ? "完成" : "done") : zh ? "编辑" : "edit"}
        </span>
      </div>
      <div className="bd" style={{ opacity: busy ? 0.6 : 1 }}>
        {terms.length === 0 && !editing && (
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
        {terms.map((q) => (
          <div key={q} className="watch-row">
            <span className="sym">▸</span>
            <span className="q">{q}</span>
            <span />
            {editing ? (
              <span
                onClick={() => remove(q)}
                style={{
                  color: "var(--accent-red)",
                  cursor: "pointer",
                  fontSize: 11,
                  textAlign: "right",
                }}
              >
                ✕
              </span>
            ) : (
              <span className="d z">—</span>
            )}
          </div>
        ))}

        {editing ? (
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTerm();
              }}
              placeholder={zh ? "输入关键词…" : "new term…"}
              maxLength={64}
              style={{
                flex: 1,
                background: "var(--bg-0)",
                border: "1px dashed var(--border-1)",
                color: "var(--fg-1)",
                padding: "6px 8px",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                outline: "none",
                borderRadius: 2,
              }}
            />
            <button
              type="button"
              onClick={addTerm}
              disabled={!draft.trim() || busy}
              style={{
                background: "transparent",
                color: "var(--accent-green)",
                border: "1px dashed var(--border-1)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                padding: "4px 10px",
                cursor: draft.trim() ? "pointer" : "not-allowed",
                borderRadius: 2,
              }}
            >
              +
            </button>
          </div>
        ) : (
          <div
            className="watch-add"
            role="button"
            onClick={() => setEditing(true)}
          >
            <span className="plus">+</span>{" "}
            {zh ? "监控新关键词" : "watch new term"}
          </div>
        )}
      </div>
    </div>
  );
}
