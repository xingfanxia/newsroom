import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sources } from "@/db/schema";
import type { ItemTier } from "@/lib/types";

export type NeverExcludeSourceIds = ReadonlySet<string>;

export async function loadNeverExcludeSourceIds(
  client: ReturnType<typeof db> = db(),
): Promise<Set<string>> {
  const rows = await client
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.neverExclude, true));
  return new Set(rows.map((row) => row.id));
}

export function applyNeverExcludeTierFloor(args: {
  sourceId: string;
  tier: ItemTier;
  neverExcludeSourceIds: NeverExcludeSourceIds;
}): ItemTier {
  return args.neverExcludeSourceIds.has(args.sourceId) &&
    args.tier === "excluded"
    ? "all"
    : args.tier;
}
