import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { closeDb, db, schema } from "@/db/client";
import {
  commitPolicyRoutePayload,
  policyCommitBodySchema,
} from "@/lib/api/policy-commit";

const hasDb = Boolean(
  process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL,
);
const describeOrSkip = hasDb ? describe : describe.skip;

describe("policy commit request schema", () => {
  test("accepts a direct admin policy commit body", () => {
    expect(
      policyCommitBodySchema.parse({
        skillName: "editorial",
        content: "Updated policy content",
        reasoning: "manual correction",
      }),
    ).toEqual({
      skillName: "editorial",
      content: "Updated policy content",
      reasoning: "manual correction",
    });
  });

  test("rejects empty names/content and overlong reasoning", () => {
    expect(
      policyCommitBodySchema.safeParse({
        skillName: "",
        content: "Updated policy content",
      }).success,
    ).toBe(false);
    expect(
      policyCommitBodySchema.safeParse({
        skillName: "editorial",
        content: "",
      }).success,
    ).toBe(false);
    expect(
      policyCommitBodySchema.safeParse({
        skillName: "editorial",
        content: "Updated policy content",
        reasoning: "x".repeat(2_001),
      }).success,
    ).toBe(false);
  });
});

describeOrSkip("commitPolicyRoutePayload (real DB)", () => {
  const skillName = `policy-commit-${crypto.randomUUID()}`;
  const admin = { email: `${skillName}@example.test` };

  afterAll(async () => {
    await db()
      .delete(schema.policyVersions)
      .where(eq(schema.policyVersions.skillName, skillName));
    await closeDb();
  });

  test("writes monotonic versions and direct-admin metadata", async () => {
    await expect(
      commitPolicyRoutePayload(admin, {
        skillName,
        content: "policy content v1",
        reasoning: "first manual edit",
      }),
    ).resolves.toEqual({ version: 1 });

    await expect(
      commitPolicyRoutePayload(admin, {
        skillName,
        content: "policy content v2",
      }),
    ).resolves.toEqual({ version: 2 });

    const rows = await db()
      .select({
        version: schema.policyVersions.version,
        content: schema.policyVersions.content,
        reasoning: schema.policyVersions.reasoning,
        feedbackCount: schema.policyVersions.feedbackCount,
        committedBy: schema.policyVersions.committedBy,
      })
      .from(schema.policyVersions)
      .where(eq(schema.policyVersions.skillName, skillName))
      .orderBy(schema.policyVersions.version);

    expect(rows).toEqual([
      {
        version: 1,
        content: "policy content v1",
        reasoning: "first manual edit",
        feedbackCount: 0,
        committedBy: admin.email,
      },
      {
        version: 2,
        content: "policy content v2",
        reasoning: null,
        feedbackCount: 0,
        committedBy: admin.email,
      },
    ]);
  });
});
