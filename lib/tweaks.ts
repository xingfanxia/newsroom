import { z } from "zod";
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

/**
 * Runtime schema for a full tweaks object — the single source of truth for
 * tweak field shapes. The server PATCH validator (`lib/api/tweak-requests`)
 * derives its partial body schema from this, and the client validates
 * persisted / fetched values against it before trusting them.
 */
export const TWEAKS_SCHEMA = z.object({
  density: z.enum(TWEAK_DENSITIES),
  accent: z.enum(TWEAK_ACCENTS),
  theme: z.enum(TWEAK_THEMES),
  monoFont: z.enum(TWEAK_MONO_FONTS),
  cjkFont: z.enum(TWEAK_CJK_FONTS),
  radius: z.enum(TWEAK_RADII),
  chromeStyle: z.enum(TWEAK_CHROME_STYLES),
  scoreStyle: z.enum(TWEAK_SCORE_STYLES),
  showTicker: z.boolean(),
  showRadar: z.boolean(),
  showPulse: z.boolean(),
  showBreadcrumb: z.boolean(),
  showLineNumbers: z.boolean(),
  mutedMeta: z.boolean(),
  language: z.enum(TWEAK_LANGUAGES),
}) satisfies z.ZodType<Tweaks>;

/**
 * Tolerantly validate an untrusted persisted / fetched tweaks blob
 * (localStorage or the `/api/tweaks` response). Each field is validated
 * independently against {@link TWEAKS_SCHEMA}; invalid or unknown fields are
 * dropped rather than rejecting the whole object, so one corrupt value can't
 * wipe a user's entire config. A `language` value is accepted here but always
 * re-derived from the URL locale by {@link resolveTweaks}.
 *
 * `raw` is expected to be plain JSON data — both call sites pass a
 * `JSON.parse`d value (localStorage / the fetched response body), so field
 * reads never hit accessor logic.
 */
export function parsePersistedTweaks(raw: unknown): Partial<Tweaks> {
  if (raw === null || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const out: Partial<Tweaks> = {};
  for (const key of Object.keys(TWEAKS_SCHEMA.shape) as (keyof Tweaks)[]) {
    if (!(key in source)) continue;
    const result = TWEAKS_SCHEMA.shape[key].safeParse(source[key]);
    // `Object.assign` (not `out[key] = …`) sidesteps the TS union-correlation
    // error; key + value both derive from the same `shape[key]`, so it's sound.
    if (result.success) Object.assign(out, { [key]: result.data });
  }
  return out;
}

/**
 * Strip the URL-derived `language` before persisting. It is never read back
 * ({@link resolveTweaks} always forces it to the URL locale), so persisting it
 * locally or on the server would only store dead, misleading data.
 */
export function persistableTweaks(tweaks: Tweaks): Omit<Tweaks, "language"> {
  const persisted = { ...tweaks };
  delete (persisted as Partial<Tweaks>).language;
  return persisted;
}
