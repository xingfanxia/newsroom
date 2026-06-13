import { z } from "zod";
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
  type Tweaks,
} from "@/lib/tweaks";

const tweakSettingsSchema = z.object({
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

export const tweaksPatchBodySchema = z.object({
  tweaks: tweakSettingsSchema.partial().optional(),
  watchlist: z.array(z.string().min(1).max(64)).max(24).optional(),
});

export type TweaksPatchBody = z.infer<typeof tweaksPatchBodySchema>;

export function buildTweaksDbPatch(
  body: TweaksPatchBody,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.tweaks !== undefined) patch.tweaks = body.tweaks;
  if (body.watchlist !== undefined) patch.watchlist = body.watchlist;
  return Object.keys(patch).length === 1 ? null : patch;
}
