import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { closeDb, db, schema } from "@/db/client";
import {
  getFeedbackCounts,
  getRecentFeedback,
} from "@/lib/feedback/metrics";

const hasDb = Boolean(
  process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL,
);
const describeOrSkip = hasDb ? describe : describe.skip;

describeOrSkip("feedback metrics (real DB)", () => {
  const USER_ID = `m3-metrics-${crypto.randomUUID()}`;
  let itemId: number | null = null;

  beforeAll(async () => {
    const rows = await db()
      .select({
        id: schema.items.id,
        titleZh: schema.items.titleZh,
        titleEn: schema.items.titleEn,
        title: schema.items.title,
      })
      .from(schema.items)
      .limit(1);
    itemId = rows[0]?.id ?? null;
    if (itemId === null) return;

    await db()
      .insert(schema.users)
      .values({
        id: USER_ID,
        email: `metrics-${Date.now()}@example.test`,
        role: "reader",
      })
      .onConflictDoNothing();

    await db()
      .insert(schema.feedback)
      .values([
        { itemId, userId: USER_ID, vote: "up", note: "nice" },
        { itemId, userId: USER_ID, vote: "save" },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db().delete(schema.users).where(eq(schema.users.id, USER_ID));
    await closeDb();
  });

  it("counts rise by the inserted votes", async () => {
    if (itemId === null) return;
    const { total, agreed, disagreed, saved } = await getFeedbackCounts();
    expect(total).toBeGreaterThanOrEqual(1);
    expect(agreed).toBeGreaterThanOrEqual(1);
    expect(saved).toBeGreaterThanOrEqual(1);
    expect(disagreed).toBeGreaterThanOrEqual(0);
  });

  it("recent feedback includes the test user's up vote and skips save", async () => {
    if (itemId === null) return;
    const entries = await getRecentFeedback("zh", 50);
    const mine = entries.filter((e) => e.note === "nice");
    expect(mine.length).toBe(1);
    expect(mine[0].verdict).toBe("up");
    // `save` is excluded from the recent feed even though the row exists.
    expect(entries.every((e) => e.verdict !== ("save" as never))).toBe(true);
  });
});
