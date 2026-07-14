import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { closeDb, db, schema } from "@/db/client";
import { commitPolicyRoutePayload } from "@/lib/api/policy-commit";
import { assertProductionIntegrationOptIn } from "@/scripts/verification/run-hermetic-tests";

assertProductionIntegrationOptIn();

describe("commitPolicyRoutePayload (real DB)", () => {
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
