"use client";
import { useTweaks, type Tweaks } from "@/hooks/use-tweaks";

const THEME_CARDS = [
  { id: "midnight" as const, name: "midnight", bg: "#0d1117", fg: "#d1d9e1", ac: "#3fb950" },
  { id: "obsidian" as const, name: "obsidian", bg: "#000000", fg: "#e6edf3", ac: "#58a6ff" },
  { id: "slate"    as const, name: "slate",    bg: "#1a1d23", fg: "#cfd3d9", ac: "#a5a5ff" },
  { id: "paper"    as const, name: "paper",    bg: "#f7f5ef", fg: "#2d2a24", ac: "#b8651d" },
];

const ACCENT_SWATCHES: Array<{ id: Tweaks["accent"]; hex: string }> = [
  { id: "green",  hex: "#3fb950" },
  { id: "blue",   hex: "#58a6ff" },
  { id: "purple", hex: "#a371f7" },
  { id: "orange", hex: "#ffa657" },
  { id: "red",    hex: "#f85149" },
  { id: "cyan",   hex: "#39d0d8" },
];

/**
 * Site configuration panel — floats bottom-right on desktop, opened via
 * the "site config" entry in the left-rail or ⌥,. Toggles theme, accent,
 * typography, shape, and layout flags. Persists via useTweaks's localStorage.
 */
export function Tweaks() {
  const { tweaks, patch, reset, open, setOpen } = useTweaks();
  if (!open) return null;

  const Seg = <K extends keyof Tweaks>({
    k,
    opts,
  }: {
    k: K;
    opts: Array<[Tweaks[K], string]>;
  }) => (
    <div className="seg">
      {opts.map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          className={`s ${tweaks[k] === v ? "on" : ""}`}
          onClick={() => patch(k, v as Tweaks[K])}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const Toggle = <K extends keyof Tweaks>({ k }: { k: K }) => (
    <button
      type="button"
      className={`tgl ${tweaks[k] ? "on" : ""}`}
      onClick={() => patch(k, !tweaks[k] as Tweaks[K])}
      aria-label={String(k)}
    >
      <span className="knob" />
    </button>
  );

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
            <Seg
              k="monoFont"
              opts={[
                ["jetbrains", "JetBrains"],
                ["ibm", "IBM Plex"],
                ["iosevka", "Iosevka"],
                ["system", "System"],
              ]}
            />
          </div>
          <div className="row">
            <div className="lbl">
              <span>CJK face</span>
              <span className="v">{tweaks.cjkFont}</span>
            </div>
            <Seg
              k="cjkFont"
              opts={[
                ["notoSerif", "Noto 衬线"],
                ["notoSans", "Noto 无衬线"],
                ["lxgw", "霞鹜文楷"],
              ]}
            />
          </div>
          <div className="row">
            <div className="lbl">
              <span>density</span>
              <span className="v">{tweaks.density}</span>
            </div>
            <Seg
              k="density"
              opts={[
                ["compact", "compact"],
                ["comfy", "comfy"],
                ["reader", "reader"],
              ]}
            />
          </div>
          <div className="row">
            <div className="lbl">
              <span>language</span>
              <span className="v">{tweaks.language}</span>
            </div>
            <Seg
              k="language"
              opts={[
                ["zh", "中文"],
                ["en", "EN"],
              ]}
            />
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
            <Seg
              k="radius"
              opts={[
                ["sharp", "sharp"],
                ["subtle", "subtle"],
                ["soft", "soft"],
                ["pill", "pill"],
              ]}
            />
          </div>
          <div className="row">
            <div className="lbl">
              <span>score visual</span>
              <span className="v">{tweaks.scoreStyle}</span>
            </div>
            <Seg
              k="scoreStyle"
              opts={[
                ["ring", "◯ ring"],
                ["bar", "▮ bar"],
                ["tag", "▢ tag"],
                ["none", "none"],
              ]}
            />
          </div>
          <div className="row">
            <div className="lbl">
              <span>chrome</span>
              <span className="v">{tweaks.chromeStyle}</span>
            </div>
            <Seg
              k="chromeStyle"
              opts={[
                ["terminal", "terminal"],
                ["clean", "clean"],
                ["brutalist", "brutalist"],
              ]}
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
            <Toggle k="showTicker" />
          </div>
          <div className="row-tg">
            <div className="lbl">
              <span>radar widget</span>
              <span className="sub">right-rail signal scanner</span>
            </div>
            <Toggle k="showRadar" />
          </div>
          <div className="row-tg">
            <div className="lbl">
              <span>24h pulse</span>
              <span className="sub">left-rail bar chart</span>
            </div>
            <Toggle k="showPulse" />
          </div>
          <div className="row-tg">
            <div className="lbl">
              <span>breadcrumb prompt</span>
              <span className="sub">ax@ax-radar path in topbar</span>
            </div>
            <Toggle k="showBreadcrumb" />
          </div>
          <div className="row-tg">
            <div className="lbl">
              <span>line numbers</span>
              <span className="sub">gutter numbering on feed</span>
            </div>
            <Toggle k="showLineNumbers" />
          </div>
          <div className="row-tg">
            <div className="lbl">
              <span>muted metadata</span>
              <span className="sub">dim source / tier / time</span>
            </div>
            <Toggle k="mutedMeta" />
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
