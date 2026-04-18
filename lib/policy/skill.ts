/**
 * Active skill loader — reads the current committed version of a named
 * policy skill (e.g. "editorial") from `policy_versions`, seeding v1 from
 * `modules/feed/runtime/policy/skills/<name>.skill.md` on first request.
 *
 * Scoring workers use this indirectly via `workers/enrich/policy.ts`;
 * the admin UI uses this directly. The filesystem copy is the editable
 * template + the guaranteed starting point — the DB row is the source of
 * truth once it exists.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { policyVersions } from "@/db/schema";

export type ActiveSkill = {
  /** Monotonic integer version per skill; v1 is the filesystem seed. */
  version: number;
  content: string;
  /** 8-char SHA-256 of content — used as a cache key by enrichment. */
  hash: string;
  committedAt: Date;
};

const SKILLS_DIR = "modules/feed/runtime/policy/skills";

function skillFilePath(name: string): string {
  return path.join(process.cwd(), SKILLS_DIR, `${name}.skill.md`);
}

function hashFor(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}

function fromRow(row: {
  version: number;
  content: string;
  committedAt: Date;
}): ActiveSkill {
  return {
    version: row.version,
    content: row.content,
    hash: hashFor(row.content),
    committedAt: row.committedAt,
  };
}

/** Latest committed version of a skill. Seeds v1 from disk on first call. */
export async function getActiveSkill(name: string): Promise<ActiveSkill> {
  const client = db();
  const latest = await client
    .select()
    .from(policyVersions)
    .where(eq(policyVersions.skillName, name))
    .orderBy(desc(policyVersions.version))
    .limit(1);
  if (latest[0]) return fromRow(latest[0]);

  const content = await readFile(skillFilePath(name), "utf8");
  const [inserted] = await client
    .insert(policyVersions)
    .values({
      skillName: name,
      version: 1,
      content,
      reasoning: null,
      feedbackSample: [],
      feedbackCount: 0,
      committedBy: "system",
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return fromRow(inserted);

  const [winner] = await client
    .select()
    .from(policyVersions)
    .where(
      and(
        eq(policyVersions.skillName, name),
        eq(policyVersions.version, 1),
      ),
    )
    .limit(1);
  if (!winner) {
    throw new Error(
      `skill "${name}": failed to seed v1 from ${skillFilePath(name)}`,
    );
  }
  return fromRow(winner);
}

/** All committed versions of a skill, newest first (for the admin UI). */
export async function listSkillVersions(name: string) {
  return db()
    .select({
      id: policyVersions.id,
      version: policyVersions.version,
      feedbackCount: policyVersions.feedbackCount,
      committedAt: policyVersions.committedAt,
      committedBy: policyVersions.committedBy,
      reasoning: policyVersions.reasoning,
    })
    .from(policyVersions)
    .where(eq(policyVersions.skillName, name))
    .orderBy(desc(policyVersions.version));
}

/** Full content of one committed version — for diff base lookups. */
export async function getSkillVersion(
  name: string,
  version: number,
): Promise<ActiveSkill | null> {
  const [row] = await db()
    .select()
    .from(policyVersions)
    .where(
      and(
        eq(policyVersions.skillName, name),
        eq(policyVersions.version, version),
      ),
    )
    .limit(1);
  return row ? fromRow(row) : null;
}

/**
 * Commit a new version atomically. Computes next version = max + 1 and
 * inserts. Returns the committed row. Caller is responsible for any cache
 * invalidation in other processes (serverless doesn't need it).
 */
export async function commitSkillVersion(input: {
  skillName: string;
  content: string;
  reasoning?: string | null;
  feedbackSample?: unknown;
  feedbackCount?: number;
  committedBy: string;
}): Promise<ActiveSkill> {
  return db().transaction(async (tx) => {
    const [prev] = await tx
      .select({ version: policyVersions.version })
      .from(policyVersions)
      .where(eq(policyVersions.skillName, input.skillName))
      .orderBy(desc(policyVersions.version))
      .limit(1);
    const nextVersion = (prev?.version ?? 0) + 1;
    const [row] = await tx
      .insert(policyVersions)
      .values({
        skillName: input.skillName,
        version: nextVersion,
        content: input.content,
        reasoning: input.reasoning ?? null,
        feedbackSample: (input.feedbackSample as never) ?? [],
        feedbackCount: input.feedbackCount ?? 0,
        committedBy: input.committedBy,
      })
      .returning();
    return fromRow(row);
  });
}
