"use client";
import { useState } from "react";
import { HkrRing } from "./hkr-ring";
import { useTweaks } from "@/hooks/use-tweaks";
import type { Story } from "@/lib/types";

type Props = {
  story: Story;
  locale: "en" | "zh";
};

function formatTime(iso: string): { hh: string; date: string; ago: string } {
  const d = new Date(iso);
  const hh = d.toTimeString().slice(0, 5);
  const date = `${String(d.getMonth() + 1).padStart(2, "0")}·${String(d.getDate()).padStart(2, "0")}`;
  const diffMs = Date.now() - d.getTime();
  const diffH = Math.floor(diffMs / 3_600_000);
  const diffD = Math.floor(diffH / 24);
  const ago =
    diffH < 1 ? "now" : diffH < 24 ? `${diffH}h ago` : `${diffD}d ago`;
  return { hh, date, ago };
}

/**
 * Feed row — bilingual title, source meta, summary, tags, score ring, and an
 * expanding panel with 精选理由 / 编辑点评 / HKR breakdown / actions.
 */
export function Item({ story, locale }: Props) {
  const [open, setOpen] = useState(false);
  const { tweaks } = useTweaks();
  const lang = tweaks.language;
  const showZh = lang === "zh";
  const { hh, date, ago } = formatTime(story.publishedAt);

  const tier = story.tier;
  const tierPill =
    tier === "p1" ? (
      <span className="tier-p1">● P1</span>
    ) : tier === "featured" ? (
      <span className="tier-f">FEATURED</span>
    ) : null;

  const reason = story.reasoning;
  const editor = story.editorNote || story.editorAnalysis;
  const hkrPass = story.hkr;

  return (
    <article
      className={`item ${tier} ${open ? "open" : ""}`}
      onClick={() => setOpen((o) => !o)}
    >
      <div className="i-time">
        <div className="hh">{hh}</div>
        <div className="ago">{ago}</div>
      </div>
      <div className="i-body">
        <div className="i-meta">
          {tierPill}
          <span className="src">{story.source.publisher}</span>
          <span className="chan">· {story.source.kindCode}</span>
          <span className="lang">{story.source.localeCode.toUpperCase()}</span>
          <span className="time-m">
            {hh} · {date}
          </span>
        </div>

        {/* Title — single-locale per tweaks.language, no duplicate en/zh. */}
        <div className={showZh ? "i-title" : "i-title-en"}>
          {!showZh && <span className="arrow">→</span>}
          {story.title}
        </div>

        {story.summary && <div className="i-sum">{story.summary}</div>}

        {story.tags.length > 0 && (
          <div className="i-tags">
            {story.tags.slice(0, 6).map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
          </div>
        )}

        <div className="i-expand" onClick={(e) => e.stopPropagation()}>
          {reason && (
            <div className="kv">
              <div className="k">{showZh ? "精选理由" : "why featured"}</div>
              <div className="v">{reason}</div>
            </div>
          )}
          {editor && (
            <div className="kv">
              <div className="k e">{showZh ? "编辑点评" : "editor note"}</div>
              <div className="v" style={{ color: "var(--fg-0)" }}>
                {editor}
              </div>
            </div>
          )}
          {hkrPass && (
            <div className="kv">
              <div className="k r">
                {showZh ? "HKR 分解" : "HKR breakdown"}
              </div>
              <div
                className="v"
                style={{
                  display: "flex",
                  gap: 16,
                  fontSize: 11.5,
                  color: "var(--fg-2)",
                }}
              >
                <span>
                  hook{" "}
                  <b
                    style={{
                      color: hkrPass.h
                        ? "var(--accent-orange)"
                        : "var(--fg-3)",
                    }}
                  >
                    {hkrPass.h ? "✓" : "—"}
                  </b>
                </span>
                <span>
                  knowledge{" "}
                  <b
                    style={{
                      color: hkrPass.k
                        ? "var(--accent-blue)"
                        : "var(--fg-3)",
                    }}
                  >
                    {hkrPass.k ? "✓" : "—"}
                  </b>
                </span>
                <span>
                  resonance{" "}
                  <b
                    style={{
                      color: hkrPass.r
                        ? "var(--accent-green)"
                        : "var(--fg-3)",
                    }}
                  >
                    {hkrPass.r ? "✓" : "—"}
                  </b>
                </span>
              </div>
            </div>
          )}
          <div className="actions">
            <a
              className="act-btn primary"
              href={story.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <span>→</span> {showZh ? "打开信源" : "open source"}
            </a>
            <button
              type="button"
              className="act-btn"
              onClick={(e) => e.stopPropagation()}
            >
              <span>★</span> {showZh ? "收藏" : "save"}
            </button>
            <button
              type="button"
              className="act-btn"
              onClick={(e) => e.stopPropagation()}
            >
              <span>⎘</span> {showZh ? "复制" : "copy"}
            </button>
            <button
              type="button"
              className="act-btn"
              onClick={(e) => e.stopPropagation()}
            >
              <span>✕</span> {showZh ? "忽略" : "dismiss"}
            </button>
          </div>
        </div>
      </div>

      <div className="i-score">
        <HkrRing score={story.importance} tier={tier} />
        {hkrPass && (
          <div className="hkr-breakdown">
            <span>
              H<b>{hkrPass.h ? 1 : 0}</b>
            </span>
            <span>
              ·K<b>{hkrPass.k ? 1 : 0}</b>
            </span>
            <span>
              ·R<b>{hkrPass.r ? 1 : 0}</b>
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
