/**
 * Real-DB integration tests for the M3 feedback schema. Skips when
 * POSTGRES_URL / DATABASE_URL is unset (CI without DB access).
 *
 * Uses a throwaway user with a random id so parallel runs + retries don't
 * collide, and cleans up in afterAll even on failure.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/db/client";

const TEST_USER_ID = `m3-test-${crypto.randomUUID()}`;
const TEST_EMAIL = `m3-test-${Date.now()}@example.test`;
const hasDb = Boolean(
  process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL,
);

async function pickAnyItemId(): Promise<number | null> {
  const rows = await db()
    .select({ id: schema.items.id })
    .from(schema.items)
    .limit(1);
  return rows[0]?.id ?? null;
}

const describeOrSkip = hasDb ? describe : describe.skip;

describeOrSkip("feedback schema round-trip (real DB)", () => {
  let itemId: number | null = null;

  beforeAll(async () => {
    itemId = await pickAnyItemId();
    if (itemId === null) return;
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
    if (itemId === null) return;
    await db()
      .insert(schema.feedback)
      .values([
        { itemId, userId: TEST_USER_ID, vote: "up" },
        { itemId, userId: TEST_USER_ID, vote: "down" },
        { itemId, userId: TEST_USER_ID, vote: "save" },
      ]);

    const rows = await db()
      .select({ vote: schema.feedback.vote })
      .from(schema.feedback)
      .where(eq(schema.feedback.userId, TEST_USER_ID));
    expect(rows.map((r) => r.vote).sort()).toEqual(["down", "save", "up"]);
  });

  it("rejects duplicate (item, user, vote) on the unique index", async () => {
    if (itemId === null) return;
    // drizzle's insert builder is thenable but not a Promise — wrap in an
    // async arrow so `rejects` sees a real Promise.
    await expect(async () => {
      await db()
        .insert(schema.feedback)
        .values({ itemId, userId: TEST_USER_ID, vote: "up" });
    }).toThrow();
  });

  it("counts feedback by vote for the test user", async () => {
    if (itemId === null) return;
    const rows = await db()
      .select({ vote: schema.feedback.vote, n: sql<number>`count(*)::int` })
      .from(schema.feedback)
      .where(eq(schema.feedback.userId, TEST_USER_ID))
      .groupBy(schema.feedback.vote);
    const byVote = Object.fromEntries(rows.map((r) => [r.vote, r.n]));
    expect(byVote.up).toBe(1);
    expect(byVote.down).toBe(1);
    expect(byVote.save).toBe(1);
  });

  it("cascades feedback deletion when the user is removed", async () => {
    if (itemId === null) return;
    // Delete the user; FK cascade should wipe the feedback rows.
    await db().delete(schema.users).where(eq(schema.users.id, TEST_USER_ID));

    const remaining = await db()
      .select({ id: schema.feedback.id })
      .from(schema.feedback)
      .where(
        and(
          eq(schema.feedback.userId, TEST_USER_ID),
          eq(schema.feedback.itemId, itemId),
        ),
      );
    expect(remaining).toHaveLength(0);
  });
});
