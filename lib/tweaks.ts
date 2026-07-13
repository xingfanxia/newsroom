import { APP_LOCALES, type AppLocale } from "@/lib/types";

export const TWEAK_DENSITIES = ["compact", "comfy", "reader"] as const;
export const TWEAK_ACCENTS = [
  "green",
  "blue",
  "purple",
  "orange",
  "red",
  "cyan",
] as const;
export const TWEAK_THEMES = ["midnight", "obsidian", "slate", "paper"] as const;
export const TWEAK_MONO_FONTS = [
  "jetbrains",
  "ibm",
  "iosevka",
  "system",
] as const;
export const TWEAK_CJK_FONTS = ["notoSerif", "notoSans", "lxgw"] as const;
export const TWEAK_RADII = ["sharp", "subtle", "soft", "pill"] as const;
export const TWEAK_CHROME_STYLES = [
  "terminal",
  "clean",
  "brutalist",
] as const;
export const TWEAK_SCORE_STYLES = ["ring", "bar", "tag", "none"] as const;
export const TWEAK_LANGUAGES = APP_LOCALES;

export type Tweaks = {
  density: (typeof TWEAK_DENSITIES)[number];
  accent: (typeof TWEAK_ACCENTS)[number];
  theme: (typeof TWEAK_THEMES)[number];
  monoFont: (typeof TWEAK_MONO_FONTS)[number];
  cjkFont: (typeof TWEAK_CJK_FONTS)[number];
  radius: (typeof TWEAK_RADII)[number];
  chromeStyle: (typeof TWEAK_CHROME_STYLES)[number];
  scoreStyle: (typeof TWEAK_SCORE_STYLES)[number];
  showTicker: boolean;
  showRadar: boolean;
  showPulse: boolean;
  showBreadcrumb: boolean;
  showLineNumbers: boolean;
  mutedMeta: boolean;
  language: AppLocale;
};

export const TWEAK_DEFAULTS: Tweaks = {
  density: "compact",
  accent: "green",
  theme: "midnight",
  monoFont: "jetbrains",
  // Noto Sans SC matches how --font-mono falls back to Sans SC for CJK
  // glyphs that JetBrains doesn't carry. Consistent nav + body rendering.
  cjkFont: "notoSans",
  radius: "sharp",
  chromeStyle: "terminal",
  scoreStyle: "ring",
  showTicker: true,
  showRadar: true,
  showPulse: true,
  showBreadcrumb: true,
  showLineNumbers: false,
  mutedMeta: true,
  language: "en",
};

/**
 * Merge persisted tweak overrides (localStorage, then server) over the
 * defaults — EXCEPT `language`.
 *
 * The UI language is the URL `[locale]` segment (the same locale the server
 * used to resolve story titles), NOT a separately-persisted value. A stale
 * persisted `language` (e.g. "zh") overriding an "/en" URL is exactly what
 * desynced Chinese chrome from English titles: chrome reads `tweaks.language`,
 * titles follow the URL. So `language` is always forced to `urlLanguage` and
 * any persisted `language` (including legacy "both") is dropped on load.
 */
export function resolveTweaks(
  urlLanguage: AppLocale,
  ...overrides: Array<Partial<Tweaks> | null | undefined>
): Tweaks {
  let out: Tweaks = { ...TWEAK_DEFAULTS, language: urlLanguage };
  for (const override of overrides) {
    if (!override) continue;
    const next: Partial<Tweaks> = { ...override };
    delete next.language;
    out = { ...out, ...next };
  }
  return out;
}
