import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const POLICY_PATH = "modules/feed/runtime/policy/skills/editorial.skill.md";

type Policy = { content: string; version: string };

let cached: Policy | null = null;

/**
 * Load the editorial policy and compute a short version hash for cache keys.
 * The first 8 chars of SHA-256 are plenty to detect policy updates; collisions
 * here would just cause one unnecessary re-enrichment, not a correctness bug.
 */
export async function loadPolicy(): Promise<Policy> {
  if (cached) return cached;
  const content = await readFile(
    path.join(process.cwd(), POLICY_PATH),
    "utf8",
  );
  const version = createHash("sha256")
    .update(content)
    .digest("hex")
    .slice(0, 8);
  cached = { content, version };
  return cached;
}

/** Force a reload — call when policy has been updated via the iteration agent. */
export function invalidatePolicyCache() {
  cached = null;
}
