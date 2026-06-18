import { getActiveSkill } from "@/lib/policy/skill";

type Policy = { content: string; version: string };

let cached: Policy | null = null;

/**
 * Load the editorial policy for the scoring worker. Returns content plus an
 * 8-char content hash stored in `items.policy_version` after a successful
 * enrich/score write. New or deliberately reset rows use the latest policy;
 * cron does not select already-enriched rows solely because this hash changed.
 * Backed by `policy_versions` in the DB with a filesystem seed on first boot;
 * see `lib/policy/skill.ts`.
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
