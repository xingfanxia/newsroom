"use client";
import { useLocale } from "next-intl";
import { useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useTweaks, type Tweaks } from "@/hooks/use-tweaks";
import {
  TWEAK_ACCENTS,
  TWEAK_CHROME_STYLES,
  TWEAK_CJK_FONTS,
  TWEAK_DENSITIES,
  TWEAK_LANGUAGES,
  TWEAK_MONO_FONTS,
  TWEAK_RADII,
  TWEAK_SCORE_STYLES,
  TWEAK_THEMES,
} from "@/lib/tweaks";
import type { AppLocale } from "@/lib/types";

type SegmentOption<K extends keyof Tweaks> = [Tweaks[K], string];

const THEME_CARD_DISPLAY = {
  midnight: { name: "midnight", bg: "#0d1117", fg: "#d1d9e1", ac: "#3fb950" },
  obsidian: { name: "obsidian", bg: "#000000", fg: "#e6edf3", ac: "#58a6ff" },
  slate: { name: "slate", bg: "#1a1d23", fg: "#cfd3d9", ac: "#a5a5ff" },
  paper: { name: "paper", bg: "#f7f5ef", fg: "#2d2a24", ac: "#b8651d" },
} satisfies Record<Tweaks["theme"], { name: string; bg: string; fg: string; ac: string }>;

const THEME_CARDS: Array<
  { id: Tweaks["theme"] } & (typeof THEME_CARD_DISPLAY)[Tweaks["theme"]]
> = TWEAK_THEMES.map((id) => ({ id, ...THEME_CARD_DISPLAY[id] }));

const ACCENT_SWATCH_HEX = {
  green: "#3fb950",
  blue: "#58a6ff",
  purple: "#a371f7",
  orange: "#ffa657",
  red: "#f85149",
  cyan: "#39d0d8",
} satisfies Record<Tweaks["accent"], string>;

const ACCENT_SWATCHES: Array<{ id: Tweaks["accent"]; hex: string }> =
  TWEAK_ACCENTS.map((id) => ({ id, hex: ACCENT_SWATCH_HEX[id] }));

const MONO_FONT_LABELS = {
  jetbrains: "JetBrains",
  ibm: "IBM Plex",
  iosevka: "Iosevka",
  system: "System",
} satisfies Record<Tweaks["monoFont"], string>;

const MONO_FONT_OPTIONS: Array<SegmentOption<"monoFont">> =
  TWEAK_MONO_FONTS.map((id): SegmentOption<"monoFont"> => [
    id,
    MONO_FONT_LABELS[id],
  ]);

const CJK_FONT_LABELS = {
  notoSerif: "Noto 衬线",
  notoSans: "Noto 无衬线",
  lxgw: "霞鹜文楷",
} satisfies Record<Tweaks["cjkFont"], string>;

const CJK_FONT_OPTIONS: Array<SegmentOption<"cjkFont">> =
  TWEAK_CJK_FONTS.map((id): SegmentOption<"cjkFont"> => [
    id,
    CJK_FONT_LABELS[id],
  ]);

const DENSITY_OPTIONS: Array<SegmentOption<"density">> =
  TWEAK_DENSITIES.map((id): SegmentOption<"density"> => [id, id]);

const LANGUAGE_LABELS = {
  zh: "中文",
  en: "EN",
} satisfies Record<Tweaks["language"], string>;

const LANGUAGE_OPTIONS: Array<SegmentOption<"language">> =
  TWEAK_LANGUAGES.map((id): SegmentOption<"language"> => [
    id,
    LANGUAGE_LABELS[id],
  ]);

const RADIUS_OPTIONS: Array<SegmentOption<"radius">> =
  TWEAK_RADII.map((id): SegmentOption<"radius"> => [id, id]);

const SCORE_STYLE_LABELS = {
  ring: "◯ ring",
  bar: "▮ bar",
  tag: "▢ tag",
  none: "none",
} satisfies Record<Tweaks["scoreStyle"], string>;

const SCORE_STYLE_OPTIONS: Array<SegmentOption<"scoreStyle">> =
  TWEAK_SCORE_STYLES.map((id): SegmentOption<"scoreStyle"> => [
    id,
    SCORE_STYLE_LABELS[id],
  ]);

const CHROME_STYLE_OPTIONS: Array<SegmentOption<"chromeStyle">> =
  TWEAK_CHROME_STYLES.map((id): SegmentOption<"chromeStyle"> => [id, id]);

type PatchTweaks = <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
type BooleanTweaksKey = {
  [K in keyof Tweaks]: Tweaks[K] extends boolean ? K : never;
}[keyof Tweaks];

function SegmentControl<K extends keyof Tweaks>({
  tweaks,
  patch,
  k,
  opts,
}: {
  tweaks: Tweaks;
  patch: PatchTweaks;
  k: K;
  opts: Array<SegmentOption<K>>;
}) {
  return (
    <div className="seg">
      {opts.map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          className={`s ${tweaks[k] === v ? "on" : ""}`}
          onClick={() => patch(k, v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ToggleControl({
  tweaks,
  patch,
  k,
}: {
  tweaks: Tweaks;
  patch: PatchTweaks;
  k: BooleanTweaksKey;
}) {
  return (
    <button
      type="button"
      className={`tgl ${tweaks[k] ? "on" : ""}`}
      onClick={() => patch(k, !tweaks[k])}
      aria-label={String(k)}
    >
      <span className="knob" />
    </button>
  );
}

/**
 * Language control — NAVIGATES the URL `[locale]` segment (next-intl) rather
 * than patching a client-only `tweaks.language`. The URL locale is what the
 * server uses to resolve story titles; a client-only toggle only flipped chrome
 * labels and left the feed titles in the old locale (Chinese chrome, English
 * titles). Navigating re-renders the feed in the chosen locale and sets
 * next-intl's NEXT_LOCALE cookie so the choice sticks on the next visit.
 */
function LanguageControl() {
  const activeLocale = useLocale() as AppLocale;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="seg" role="group" aria-label="language">
      {LANGUAGE_OPTIONS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={activeLocale === value}
          className={`s ${activeLocale === value ? "on" : ""}`}
          disabled={pending}
          onClick={() => {
            if (activeLocale === value) return;
            // Carry the active feed filters (tier/source/date/view live in the
            // query string) across the locale switch — a bare pathname replace
            // would drop them.
            const query = Object.fromEntries(searchParams.entries());
            startTransition(() =>
              router.replace({ pathname, query }, { locale: value }),
            );
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Site configuration panel — floats bottom-right on desktop, opened via
 * the "site config" entry in the left-rail or ⌥,. Toggles theme, accent,
 * typography, shape, and layout flags. Persists via useTweaks's localStorage.
 */
export function Tweaks() {
  const { tweaks, patch, reset, open, setOpen } = useTweaks();
  if (!open) return null;

  return (
    <div className="tweaks on scroll-dark">
      <div className="thd">
        <span className="ttl">
          <span className="dot">●</span> configure{" "}
          <span className="cn">站点配置</span>
        </span>
        <span className="thd-actions">
          <span
            className="reset"
            onClick={reset}
            title="reset to defaults"
            role="button"
          >
            ↺ reset
          </span>
          <span className="x" onClick={() => setOpen(false)} role="button">
            ✕
          </span>
        </span>
      </div>

      <div className="tbd">
        {/* Theme + accent */}
        <div className="tgroup">
          <div className="tghd">theme · 主题</div>
          <div className="row">
            <div className="lbl">
              <span>palette</span>
              <span className="v">{tweaks.theme}</span>
            </div>
            <div className="theme-cards">
              {THEME_CARDS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`theme-card ${tweaks.theme === t.id ? "on" : ""}`}
                  onClick={() => patch("theme", t.id)}
                >
                  <div className="tcard-preview" style={{ background: t.bg }}>
                    <div className="tcard-bar" style={{ background: t.ac }} />
                    <div
                      className="tcard-line"
                      style={{ background: t.fg, opacity: 0.8, width: "60%" }}
                    />
                    <div
                      className="tcard-line"
                      style={{ background: t.fg, opacity: 0.4, width: "40%" }}
                    />
                  </div>
                  <div className="tcard-name">{t.name}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <div className="lbl">
              <span>signal accent</span>
              <span className="v">{tweaks.accent}</span>
            </div>
            <div className="swatches">
              {ACCENT_SWATCHES.map((s) => (
                <div
                  key={s.id}
                  className={`sw ${tweaks.accent === s.id ? "on" : ""}`}
                  style={{ background: s.hex }}
                  onClick={() => patch("accent", s.id)}
                  role="button"
                />
              ))}
            </div>
          </div>
        </div>

        {/* Typography */}
        <div className="tgroup">
          <div className="tghd">typography · 排版</div>
          <div className="row">
            <div className="lbl">
              <span>mono face</span>
              <span className="v">{tweaks.monoFont}</span>
            </div>
            <SegmentControl
              tweaks={tweaks}
              patch={patch}
              k="monoFont"
              opts={MONO_FONT_OPTIONS}
            />
          </div>
          <div className="row">
            <div className="lbl">
              <span>CJK face</span>
              <span className="v">{tweaks.cjkFont}</span>
            </div>
            <SegmentControl
              tweaks={tweaks}
              patch={patch}
              k="cjkFont"
              opts={CJK_FONT_OPTIONS}
            />
          </div>
          <div className="row">
            <div className="lbl">
              <span>density</span>
              <span className="v">{tweaks.density}</span>
            </div>
            <SegmentControl
              tweaks={tweaks}
              patch={patch}
              k="density"
              opts={DENSITY_OPTIONS}
            />
          </div>
          <div className="row">
            <div className="lbl">
              <span>language</span>
              <span className="v">{tweaks.language}</span>
            </div>
            <LanguageControl />
          </div>
        </div>

        {/* Shape */}
        <div className="tgroup">
          <div className="tghd">shape · 形态</div>
          <div className="row">
            <div className="lbl">
              <span>corner radius</span>
              <span className="v">{tweaks.radius}</span>
            </div>
            <SegmentControl
              tweaks={tweaks}
              patch={patch}
              k="radius"
              opts={RADIUS_OPTIONS}
            />
          </div>
          <div className="row">
            <div className="lbl">
              <span>score visual</span>
              <span className="v">{tweaks.scoreStyle}</span>
            </div>
            <SegmentControl
              tweaks={tweaks}
              patch={patch}
              k="scoreStyle"
              opts={SCORE_STYLE_OPTIONS}
            />
          </div>
          <div className="row">
            <div className="lbl">
              <span>chrome</span>
              <span className="v">{tweaks.chromeStyle}</span>
            </div>
            <SegmentControl
              tweaks={tweaks}
              patch={patch}
              k="chromeStyle"
              opts={CHROME_STYLE_OPTIONS}
            />
          </div>
        </div>

        {/* Layout flags */}
        <div className="tgroup">
          <div className="tghd">layout · 布局</div>
          <div className="row-tg">
            <div className="lbl">
              <span>ticker</span>
              <span className="sub">top scrolling headlines</span>
            </div>
            <ToggleControl tweaks={tweaks} patch={patch} k="showTicker" />
          </div>
          <div className="row-tg">
            <div className="lbl">
              <span>radar widget</span>
              <span className="sub">right-rail signal scanner</span>
            </div>
            <ToggleControl tweaks={tweaks} patch={patch} k="showRadar" />
          </div>
          <div className="row-tg">
            <div className="lbl">
              <span>24h pulse</span>
              <span className="sub">left-rail bar chart</span>
            </div>
            <ToggleControl tweaks={tweaks} patch={patch} k="showPulse" />
          </div>
          <div className="row-tg">
            <div className="lbl">
              <span>breadcrumb prompt</span>
              <span className="sub">ax@ax-radar path in topbar</span>
            </div>
            <ToggleControl tweaks={tweaks} patch={patch} k="showBreadcrumb" />
          </div>
          <div className="row-tg">
            <div className="lbl">
              <span>line numbers</span>
              <span className="sub">gutter numbering on feed</span>
            </div>
            <ToggleControl tweaks={tweaks} patch={patch} k="showLineNumbers" />
          </div>
          <div className="row-tg">
            <div className="lbl">
              <span>muted metadata</span>
              <span className="sub">dim source / tier / time</span>
            </div>
            <ToggleControl tweaks={tweaks} patch={patch} k="mutedMeta" />
          </div>
        </div>

        <div className="tftr">
          <span className="fsym">$</span>
          <span>
            config saved to <b>local</b> · persists per browser
          </span>
        </div>
      </div>
    </div>
  );
}
