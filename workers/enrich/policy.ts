import { getActiveSkill } from "@/lib/policy/skill";

type Policy = { content: string; version: string };

let cached: Policy | null = null;

/**
 * Load the editorial policy for the scoring worker. Returns content plus an
 * 8-char content hash used as the `items.policy_version` cache key — when the
 * hash changes, workers re-enrich. Backed by `policy_versions` in the DB with
 * a filesystem seed on first boot; see `lib/policy/skill.ts`.
 */
export async function loadPolicy(): Promise<Policy> {
  if (cached) return cached;
  const skill = await getActiveSkill("editorial");
  cached = { content: skill.content, version: skill.hash };
  return cached;
}

/** Force a reload — call when policy has been updated via the iteration agent. */
export function invalidatePolicyCache() {
  cached = null;
}
