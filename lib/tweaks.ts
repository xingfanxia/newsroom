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
export const TWEAK_LANGUAGES = ["zh", "en"] as const;

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
  language: (typeof TWEAK_LANGUAGES)[number];
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
