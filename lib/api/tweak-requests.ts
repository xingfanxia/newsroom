import { z } from "zod";
import { TWEAKS_SCHEMA } from "@/lib/tweaks";
import {
  MAX_WATCHLIST_TERM_CHARS,
  MAX_WATCHLIST_TERMS,
  normalizeWatchlist,
} from "@/lib/watchlist";

export const tweaksPatchBodySchema = z.object({
  // `TWEAKS_SCHEMA` is the single source of truth for tweak field shapes; the
  // PATCH body accepts any subset of the persistable fields. `language` is
  // URL-derived (never persisted — see `persistableTweaks`), so it's omitted
  // here: a stray/legacy client that sends it has it stripped, not stored.
  tweaks: TWEAKS_SCHEMA.omit({ language: true }).partial().optional(),
  watchlist: z
    .array(z.string())
    .transform(normalizeWatchlist)
    .pipe(
      z
        .array(z.string().min(1).max(MAX_WATCHLIST_TERM_CHARS))
        .max(MAX_WATCHLIST_TERMS),
    )
    .optional(),
});

export type TweaksPatchBody = z.infer<typeof tweaksPatchBodySchema>;

export function buildTweaksDbPatch(
  body: TweaksPatchBody,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.tweaks !== undefined) patch.tweaks = body.tweaks;
  if (body.watchlist !== undefined) {
    patch.watchlist = normalizeWatchlist(body.watchlist);
  }
  return Object.keys(patch).length === 1 ? null : patch;
}
