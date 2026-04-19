import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { feedback, savedCollections } from "@/db/schema";

export type SavedCollection = {
  id: number;
  name: string;
  nameCjk: string | null;
  pinned: boolean;
  sortOrder: number;
  count: number;
  createdAt: string;
};

/** Virtual "inbox" collection id — represents uncategorized (collection_id IS NULL) saves. */
export const INBOX_COLLECTION = "inbox" as const;

/**
 * List all named collections for a user + running save counts.
 * Pinned collections surface first. Unrelated to the virtual `inbox` bucket,
 * which is derived at render-time by counting feedback rows with null collection_id.
 */
export async function listCollections(userId: string): Promise<SavedCollection[]> {
  const rows = await db()
    .select({
      id: savedCollections.id,
      name: savedCollections.name,
      nameCjk: savedCollections.nameCjk,
      pinned: savedCollections.pinned,
      sortOrder: savedCollections.sortOrder,
      createdAt: savedCollections.createdAt,
      count: sql<number>`
        (SELECT count(*) FROM ${feedback}
         WHERE ${feedback.userId} = ${savedCollections.userId}
           AND ${feedback.vote} = 'save'
           AND ${feedback.collectionId} = ${savedCollections.id})::int
      `,
    })
    .from(savedCollections)
    .where(eq(savedCollections.userId, userId))
    .orderBy(
      desc(savedCollections.pinned),
      asc(savedCollections.sortOrder),
      desc(savedCollections.createdAt),
    );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nameCjk: r.nameCjk,
    pinned: r.pinned,
    sortOrder: r.sortOrder,
    count: r.count,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Count of uncategorized (inbox) saves for a user. */
export async function getInboxCount(userId: string): Promise<number> {
  const [row] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(feedback)
    .where(
      and(
        eq(feedback.userId, userId),
        eq(feedback.vote, "save"),
        sql`${feedback.collectionId} IS NULL`,
      ),
    );
  return row?.n ?? 0;
}

/**
 * Create a new named collection. Throws if name is empty or clashes with an
 * existing collection for this user (unique index is the backstop).
 */
export async function createCollection(input: {
  userId: string;
  name: string;
  nameCjk?: string | null;
  pinned?: boolean;
}): Promise<SavedCollection> {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error("collection name required");
  if (trimmed.length > 64) throw new Error("collection name too long");

  const [row] = await db()
    .insert(savedCollections)
    .values({
      userId: input.userId,
      name: trimmed,
      nameCjk: input.nameCjk?.trim() || null,
      pinned: input.pinned ?? false,
    })
    .returning();

  return {
    id: row.id,
    name: row.name,
    nameCjk: row.nameCjk,
    pinned: row.pinned,
    sortOrder: row.sortOrder,
    count: 0,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Rename / pin / unpin in one call. Only the owner can mutate. */
export async function updateCollection(input: {
  userId: string;
  id: number;
  name?: string;
  nameCjk?: string | null;
  pinned?: boolean;
}): Promise<boolean> {
  const patch: Partial<typeof savedCollections.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error("collection name required");
    if (trimmed.length > 64) throw new Error("collection name too long");
    patch.name = trimmed;
  }
  if (input.nameCjk !== undefined) patch.nameCjk = input.nameCjk?.trim() || null;
  if (input.pinned !== undefined) patch.pinned = input.pinned;

  const result = await db()
    .update(savedCollections)
    .set(patch)
    .where(
      and(
        eq(savedCollections.id, input.id),
        eq(savedCollections.userId, input.userId),
      ),
    )
    .returning({ id: savedCollections.id });

  return result.length > 0;
}

/**
 * Delete a collection. Thanks to ON DELETE SET NULL on feedback.collection_id,
 * the user's saved items are reparented to the inbox rather than removed.
 */
export async function deleteCollection(
  userId: string,
  id: number,
): Promise<boolean> {
  const result = await db()
    .delete(savedCollections)
    .where(
      and(
        eq(savedCollections.id, id),
        eq(savedCollections.userId, userId),
      ),
    )
    .returning({ id: savedCollections.id });
  return result.length > 0;
}

/**
 * Move a saved item between collections. Passing `targetCollectionId = null`
 * moves it to the inbox. Only the owner's saves are mutable.
 */
export async function moveItemToCollection(input: {
  userId: string;
  itemId: number;
  targetCollectionId: number | null;
}): Promise<boolean> {
  const result = await db()
    .update(feedback)
    .set({ collectionId: input.targetCollectionId })
    .where(
      and(
        eq(feedback.userId, input.userId),
        eq(feedback.itemId, input.itemId),
        eq(feedback.vote, "save"),
      ),
    )
    .returning({ id: feedback.id });
  return result.length > 0;
}
