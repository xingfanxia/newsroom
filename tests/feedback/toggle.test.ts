import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { closeDb, db, schema } from "@/db/client";
import {
  applyFeedbackToggle,
  currentVotes,
  feedbackBodySchema,
} from "@/lib/feedback/toggle";

describe("feedbackBodySchema", () => {
  it("accepts a valid up/on payload", () => {
    const parsed = feedbackBodySchema.safeParse({
      itemId: 1,
      vote: "up",
      on: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown vote values", () => {
    const parsed = feedbackBodySchema.safeParse({
      itemId: 1,
      vote: "love",
      on: true,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects non-integer itemId", () => {
    const parsed = feedbackBodySchema.safeParse({
      itemId: 1.5,
      vote: "up",
      on: true,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects zero / negative itemId", () => {
    expect(
      feedbackBodySchema.safeParse({ itemId: 0, vote: "up", on: true }).success,
    ).toBe(false);
    expect(
      feedbackBodySchema.safeParse({ itemId: -1, vote: "up", on: true }).success,
    ).toBe(false);
  });

  it("rejects notes above 500 chars", () => {
    const parsed = feedbackBodySchema.safeParse({
      itemId: 1,
      vote: "down",
      on: true,
      note: "x".repeat(501),
    });
    expect(parsed.success).toBe(false);
  });
});

const hasDb = Boolean(
  process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL,
);
const describeOrSkip = hasDb ? describe : describe.skip;

describeOrSkip("applyFeedbackToggle (real DB)", () => {
  const TEST_USER_ID = `m3-toggle-${crypto.randomUUID()}`;
  const TEST_EMAIL = `m3-toggle-${Date.now()}@example.test`;
  let itemId: number | null = null;

  async function cleanFeedback() {
    await db()
      .delete(schema.feedback)
      .where(eq(schema.feedback.userId, TEST_USER_ID));
  }

  beforeAll(async () => {
    const rows = await db()
      .select({ id: schema.items.id })
      .from(schema.items)
      .limit(1);
    itemId = rows[0]?.id ?? null;
  });

  afterAll(async () => {
    await cleanFeedback();
    await db().delete(schema.users).where(eq(schema.users.id, TEST_USER_ID));
    await closeDb();
  });

  it("setting up=on while down exists clears down (mutual exclusion)", async () => {
    if (itemId === null) return;
    await cleanFeedback();
    const user = { id: TEST_USER_ID, email: TEST_EMAIL, isAdmin: false };

    // Pre-seed a 'down' vote directly.
    await applyFeedbackToggle(user, { itemId, vote: "down", on: true });
    expect((await currentVotes(TEST_USER_ID, itemId)).down).toBe(true);

    // Now toggle 'up' on — 'down' should clear.
    const after = await applyFeedbackToggle(user, {
      itemId,
      vote: "up",
      on: true,
    });
    expect(after).toEqual({ up: true, down: false, save: false });
  });

  it("save is independent of up/down and persists through them", async () => {
    if (itemId === null) return;
    await cleanFeedback();
    const user = { id: TEST_USER_ID, email: TEST_EMAIL, isAdmin: false };

    await applyFeedbackToggle(user, { itemId, vote: "save", on: true });
    await applyFeedbackToggle(user, { itemId, vote: "up", on: true });
    const state = await currentVotes(TEST_USER_ID, itemId);
    expect(state).toEqual({ up: true, down: false, save: true });
  });

  it("setting on=false clears the vote", async () => {
    if (itemId === null) return;
    await cleanFeedback();
    const user = { id: TEST_USER_ID, email: TEST_EMAIL, isAdmin: false };

    await applyFeedbackToggle(user, { itemId, vote: "up", on: true });
    const after = await applyFeedbackToggle(user, {
      itemId,
      vote: "up",
      on: false,
    });
    expect(after.up).toBe(false);
  });

  it("is idempotent — setting the same vote twice still yields one row", async () => {
    if (itemId === null) return;
    await cleanFeedback();
    const user = { id: TEST_USER_ID, email: TEST_EMAIL, isAdmin: false };

    await applyFeedbackToggle(user, { itemId, vote: "up", on: true });
    await applyFeedbackToggle(user, { itemId, vote: "up", on: true });

    const rows = await db()
      .select({ id: schema.feedback.id })
      .from(schema.feedback)
      .where(
        and(
          eq(schema.feedback.userId, TEST_USER_ID),
          eq(schema.feedback.itemId, itemId),
          eq(schema.feedback.vote, "up"),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("upserts an app user row on first toggle so the FK resolves", async () => {
    if (itemId === null) return;
    // Ensure no user row exists before this test.
    await db().delete(schema.users).where(eq(schema.users.id, TEST_USER_ID));
    const user = { id: TEST_USER_ID, email: TEST_EMAIL, isAdmin: false };

    await applyFeedbackToggle(user, { itemId, vote: "save", on: true });

    const rows = await db()
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, TEST_USER_ID));
    expect(rows[0]?.email).toBe(TEST_EMAIL);
  });
});
