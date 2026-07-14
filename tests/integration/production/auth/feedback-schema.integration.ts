/**
 * Real-DB integration tests for the M3 feedback schema. The explicit
 * production-integration runner owns opt-in and credential validation.
 *
 * Uses a throwaway user with a random id so parallel runs + retries don't
 * collide, and cleans up in afterAll even on failure.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/db/client";
import { assertProductionIntegrationOptIn } from "@/scripts/verification/run-hermetic-tests";
import { requireProductionFixture } from "@/tests/integration/production/preconditions";

assertProductionIntegrationOptIn();

const TEST_USER_ID = `m3-test-${crypto.randomUUID()}`;
const TEST_EMAIL = `m3-test-${Date.now()}@example.test`;

async function pickAnyItemId(): Promise<number | null> {
  const rows = await db()
    .select({ id: schema.items.id })
    .from(schema.items)
    .limit(1);
  return rows[0]?.id ?? null;
}

describe("feedback schema round-trip (real DB)", () => {
  let itemId: number | null = null;

  beforeAll(async () => {
    itemId = await pickAnyItemId();
    requireProductionFixture(
      itemId,
      "items table must contain a row for feedback schema coverage",
    );
    await db()
      .insert(schema.users)
      .values({
        id: TEST_USER_ID,
        email: TEST_EMAIL,
        role: "reader",
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    try {
      await db()
        .delete(schema.users)
        .where(eq(schema.users.id, TEST_USER_ID));
    } finally {
      await closeDb();
    }
  });

  it("inserts up + down + save as three distinct rows for the same item+user", async () => {
    const existingItemId = requireProductionFixture(
      itemId,
      "feedback insert test requires the setup item",
    );
    await db()
      .insert(schema.feedback)
      .values([
        { itemId: existingItemId, userId: TEST_USER_ID, vote: "up" },
        { itemId: existingItemId, userId: TEST_USER_ID, vote: "down" },
        { itemId: existingItemId, userId: TEST_USER_ID, vote: "save" },
      ]);

    const rows = await db()
      .select({ vote: schema.feedback.vote })
      .from(schema.feedback)
      .where(eq(schema.feedback.userId, TEST_USER_ID));
    expect(rows.map((r) => r.vote).sort()).toEqual(["down", "save", "up"]);
  });

  it("rejects duplicate (item, user, vote) on the unique index", async () => {
    const existingItemId = requireProductionFixture(
      itemId,
      "duplicate feedback test requires the setup item",
    );
    // drizzle's insert builder is thenable but not a Promise — wrap in an
    // async arrow so `rejects` sees a real Promise.
    await expect(async () => {
      await db()
        .insert(schema.feedback)
        .values({ itemId: existingItemId, userId: TEST_USER_ID, vote: "up" });
    }).toThrow();
  });

  it("counts feedback by vote for the test user", async () => {
    requireProductionFixture(itemId, "feedback count test requires the setup item");
    const rows = await db()
      .select({ vote: schema.feedback.vote, n: sql<number>`count(*)` })
      .from(schema.feedback)
      .where(eq(schema.feedback.userId, TEST_USER_ID))
      .groupBy(schema.feedback.vote);
    const byVote = Object.fromEntries(rows.map((r) => [r.vote, r.n]));
    expect(byVote.up).toBe(1);
    expect(byVote.down).toBe(1);
    expect(byVote.save).toBe(1);
  });

  it("cascades feedback deletion when the user is removed", async () => {
    const existingItemId = requireProductionFixture(
      itemId,
      "feedback cascade test requires the setup item",
    );
    // Delete the user; FK cascade should wipe the feedback rows.
    await db().delete(schema.users).where(eq(schema.users.id, TEST_USER_ID));

    const remaining = await db()
      .select({ id: schema.feedback.id })
      .from(schema.feedback)
      .where(
        and(
          eq(schema.feedback.userId, TEST_USER_ID),
          eq(schema.feedback.itemId, existingItemId),
        ),
      );
    expect(remaining).toHaveLength(0);
  });
});
