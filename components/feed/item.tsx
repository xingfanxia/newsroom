"use client";
import { useState } from "react";
import { HkrRing } from "./hkr-ring";
import { EventBadge } from "./event-badge";
import { CoverageChip } from "./coverage-chip";
import { SignalDrawer } from "./signal-drawer";
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
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  // Render note + analysis separately so the one-liner stance doesn't mask
  // the multi-paragraph deep dive. Previously `note || analysis` meant a
  // present note always hid the long-form analysis behind it.
  const editorNote = story.editorNote;
  const editorAnalysis = story.editorAnalysis;
  const hkrPass = story.hkr;

  async function toggleSave(e: React.MouseEvent) {
    e.stopPropagation();
    if (saving) return;
    setSaving(true);
    const next = !saved;
    setSaved(next); // optimistic
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: Number(story.id),
          vote: "save",
          on: next,
        }),
      });
      if (!res.ok) setSaved(!next); // rollback
    } catch {
      setSaved(!next);
    } finally {
      setSaving(false);
    }
  }

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
          <EventBadge story={story} showZh={showZh} />
          {tierPill}
          <span className="src">{story.source.publisher}</span>
          <span className="chan">· {story.source.kindCode}</span>
          <span className="lang">{story.source.localeCode.toUpperCase()}</span>
          <span className="time-m">
            {hh} · {date}
          </span>
          <CoverageChip
            story={story}
            showZh={showZh}
            onClick={() => setDrawerOpen((d) => !d)}
          />
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
          {editorNote && (
            <div className="kv tldr">
              <div className="k e">{showZh ? "编辑点评" : "editor tl;dr"}</div>
              <div className="v">{editorNote}</div>
            </div>
          )}
          {editorAnalysis && editorAnalysis !== editorNote && (
            <div className="kv analysis">
              <div className="k">{showZh ? "深度解读" : "deep read"}</div>
              <div className="v">{editorAnalysis}</div>
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
              onClick={toggleSave}
              disabled={saving}
              style={{
                color: saved ? "var(--accent-green)" : undefined,
                borderColor: saved ? "var(--accent-green)" : undefined,
                opacity: saving ? 0.6 : 1,
              }}
            >
              <span>{saved ? "✓" : "★"}</span>{" "}
              {saved
                ? showZh
                  ? "已收藏"
                  : "saved"
                : showZh
                  ? "收藏"
                  : "save"}
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

        <SignalDrawer
          clusterId={story.clusterId}
          locale={locale}
          showZh={showZh}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
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
