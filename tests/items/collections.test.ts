import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { closeDb, db, schema } from "@/db/client";
import {
  assignSavedItemCollection,
  getSavedItemCollectionId,
  moveItemToCollection,
  userOwnsSavedCollection,
} from "@/lib/items/collections";

const hasDb = Boolean(
  process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL,
);
const describeOrSkip = hasDb ? describe : describe.skip;

describeOrSkip("saved collection ownership (real DB)", () => {
  const ownerUserId = `m3-collections-owner-${crypto.randomUUID()}`;
  const otherUserId = `m3-collections-other-${crypto.randomUUID()}`;
  let itemId: number | null = null;
  let ownerCollectionId: number | null = null;
  let otherCollectionId: number | null = null;

  async function resetSave(collectionId: number | null) {
    if (itemId === null) return;
    await db()
      .delete(schema.feedback)
      .where(
        and(
          eq(schema.feedback.userId, ownerUserId),
          eq(schema.feedback.itemId, itemId),
          eq(schema.feedback.vote, "save"),
        ),
      );
    await db().insert(schema.feedback).values({
      userId: ownerUserId,
      itemId,
      vote: "save",
      collectionId,
    });
  }

  beforeAll(async () => {
    const items = await db()
      .select({ id: schema.items.id })
      .from(schema.items)
      .limit(1);
    itemId = items[0]?.id ?? null;
    if (itemId === null) return;

    await db()
      .insert(schema.users)
      .values([
        {
          id: ownerUserId,
          email: `${ownerUserId}@example.test`,
          role: "reader",
        },
        {
          id: otherUserId,
          email: `${otherUserId}@example.test`,
          role: "reader",
        },
      ])
      .onConflictDoNothing();

    const [ownerCollection] = await db()
      .insert(schema.savedCollections)
      .values({
        userId: ownerUserId,
        name: `owner-${crypto.randomUUID()}`,
      })
      .returning({ id: schema.savedCollections.id });
    const [otherCollection] = await db()
      .insert(schema.savedCollections)
      .values({
        userId: otherUserId,
        name: `other-${crypto.randomUUID()}`,
      })
      .returning({ id: schema.savedCollections.id });
    ownerCollectionId = ownerCollection.id;
    otherCollectionId = otherCollection.id;
  });

  afterAll(async () => {
    await db().delete(schema.users).where(eq(schema.users.id, ownerUserId));
    await db().delete(schema.users).where(eq(schema.users.id, otherUserId));
    await closeDb();
  });

  it("rejects another user's collection id and preserves the save", async () => {
    if (
      itemId === null ||
      ownerCollectionId === null ||
      otherCollectionId === null
    ) {
      return;
    }
    await resetSave(null);
    expect(
      await userOwnsSavedCollection(ownerUserId, ownerCollectionId),
    ).toBe(true);
    expect(
      await userOwnsSavedCollection(ownerUserId, otherCollectionId),
    ).toBe(false);

    const foreign = await assignSavedItemCollection({
      userId: ownerUserId,
      itemId,
      targetCollectionId: otherCollectionId,
    });
    expect(foreign).toEqual({
      ok: false,
      reason: "collection_not_found",
    });
    expect(await getSavedItemCollectionId(ownerUserId, itemId)).toBeNull();

    const owned = await assignSavedItemCollection({
      userId: ownerUserId,
      itemId,
      targetCollectionId: ownerCollectionId,
    });
    expect(owned).toEqual({
      ok: true,
      collectionId: ownerCollectionId,
    });
    expect(await getSavedItemCollectionId(ownerUserId, itemId)).toBe(
      ownerCollectionId,
    );
  });

  it("move helper also rejects cross-owner collections", async () => {
    if (
      itemId === null ||
      ownerCollectionId === null ||
      otherCollectionId === null
    ) {
      return;
    }
    await resetSave(ownerCollectionId);

    await expect(
      moveItemToCollection({
        userId: ownerUserId,
        itemId,
        targetCollectionId: otherCollectionId,
      }),
    ).resolves.toBe(false);
    expect(await getSavedItemCollectionId(ownerUserId, itemId)).toBe(
      ownerCollectionId,
    );

    await expect(
      moveItemToCollection({
        userId: ownerUserId,
        itemId,
        targetCollectionId: null,
      }),
    ).resolves.toBe(true);
    expect(await getSavedItemCollectionId(ownerUserId, itemId)).toBeNull();
  });
});
