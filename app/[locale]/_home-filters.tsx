"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useTweaks } from "@/hooks/use-tweaks";
import type { SourcePreset } from "./_source-presets";

export type HomeTier = "featured" | "p1";
export type HomeView = "today" | "daily";

const VIEW_OPTS: Array<{ v: HomeView; en: string; zh: string }> = [
  { v: "today", en: "today",  zh: "今日热点" },
  { v: "daily", en: "digest", zh: "每日精选" },
];

const TIER_OPTS: Array<{ v: HomeTier; en: string; zh: string; count?: string }> = [
  { v: "featured", en: "featured", zh: "精选" },
  { v: "p1",       en: "P1",       zh: "P1" },
];

const SOURCE_OPTS: Array<{ v: SourcePreset; en: string; zh: string }> = [
  { v: "all",        en: "all",         zh: "全部" },
  { v: "official",   en: "official",    zh: "官网" },
  { v: "newsletter", en: "newsletter",  zh: "通讯" },
  { v: "media",      en: "media",       zh: "媒体" },
  { v: "x",          en: "X",           zh: "X" },
  { v: "research",   en: "research",    zh: "研究" },
];

/**
 * Home page filter bar — combines tier pills + source-type pills into one
 * horizontal strip. Writes URL params (shallow, server re-fetches on nav).
 */
export function HomeFilters({
  tier,
  source,
  view,
}: {
  tier: HomeTier;
  source: SourcePreset;
  /** Omit on pages where the today/daily toggle is meaningless (e.g. /all,
   *  which is its own tier-all stream and doesn't honor the view param). */
  view?: HomeView;
}) {
  const { tweaks } = useTweaks();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const zh = tweaks.language === "zh";

  const push = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      // 'today' is the new default for view (post 2026-05-08 cutover) — drop
      // the param when set to today so the URL stays clean.
      if (
        v == null ||
        v === "" ||
        v === "all" ||
        v === "featured" ||
        (k === "view" && v === "today")
      ) {
        next.delete(k);
      } else {
        next.set(k, v);
      }
    }
    // Preset pills and source_id are mutually exclusive. Clicking a preset
    // drops the pinned publisher so the URL stays interpretable.
    if (patch.source !== undefined) next.delete("source_id");
    // Daily-digest mode (3-per-day across history) is only meaningful when
    // there's no source filter — the maxPerDay cap doesn't apply otherwise.
    // Clicking "每日精选" therefore resets source filters so the user lands
    // in the canonical unfiltered digest mode.
    if (patch.view === "daily") {
      next.delete("source");
      next.delete("source_id");
    }
    const qs = next.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };

  return (
    <div className="filters" style={{ opacity: pending ? 0.6 : 1 }}>
      {view !== undefined && (
        <div className="fil-grp">
          {VIEW_OPTS.map((o) => (
            <button
              key={o.v}
              type="button"
              className={`fil ${view === o.v ? "on" : ""}`}
              onClick={() => push({ view: o.v })}
              title={
                o.v === "today"
                  ? zh
                    ? "今天的热点（按重要度排序）"
                    : "today's hot events, importance-sorted"
                  : zh
                    ? "每日精选 · 每天最多 3 条"
                    : "daily digest · up to 3 per day"
              }
            >
              {zh ? o.zh : o.en}
            </button>
          ))}
        </div>
      )}
      <div className="fil-grp">
        {TIER_OPTS.map((o) => (
          <button
            key={o.v}
            type="button"
            className={`fil ${tier === o.v ? "on" : ""} ${o.v === "p1" ? "p1" : ""}`}
            onClick={() => push({ tier: o.v })}
          >
            {zh ? o.zh : o.en}
          </button>
        ))}
      </div>
      <div className="fil-grp">
        {SOURCE_OPTS.map((o) => (
          <button
            key={o.v}
            type="button"
            className={`fil ${source === o.v ? "on" : ""}`}
            onClick={() => push({ source: o.v })}
          >
            {zh ? o.zh : o.en}
          </button>
        ))}
      </div>
      <div className="fil-spacer" />
      <div className="fil-right">
        <a
          href={zh ? "/api/feed/zh/rss.xml" : "/api/feed/en/rss.xml"}
          className="mini-btn"
          target="_blank"
          rel="noreferrer"
        >
          <span>⤓</span> RSS
        </a>
        <span className="mini-btn live">
          <span className="dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent-green)" }} /> live
        </span>
      </div>
    </div>
  );
}
