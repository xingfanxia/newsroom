import {
  createCollection,
  deleteCollection,
  listCollections,
  updateCollection,
  type SavedCollection,
} from "@/lib/items/collections";
import { isDuplicateCollectionNameError } from "@/lib/api/collection-requests";

type CollectionRouteError = {
  ok: false;
  error: "duplicate_name" | "not_found";
  status: 404 | 409;
};

type CollectionRouteResult<T = Record<string, never>> =
  | { ok: true; payload: T }
  | CollectionRouteError;

type CollectionCreateInput = {
  userId: string;
  name: string;
  nameCjk?: string | null;
  pinned?: boolean;
};

type CollectionUpdateInput = {
  userId: string;
  id: number;
  name?: string;
  nameCjk?: string | null;
  pinned?: boolean;
};

export async function listCollectionRoutePayload(
  userId: string,
): Promise<{ collections: SavedCollection[]; total: number }> {
  const collections = await listCollections(userId);
  return { collections, total: collections.length };
}

export async function createCollectionRoutePayload(
  input: CollectionCreateInput,
): Promise<CollectionRouteResult<{ collection: SavedCollection }>> {
  try {
    const collection = await createCollection(input);
    return { ok: true, payload: { collection } };
  } catch (err) {
    if (isDuplicateCollectionNameError(err)) {
      return { ok: false, error: "duplicate_name", status: 409 };
    }
    throw err;
  }
}

export async function updateCollectionRoutePayload(
  input: CollectionUpdateInput,
): Promise<CollectionRouteResult> {
  const ok = await updateCollection(input);
  return ok
    ? { ok: true, payload: {} }
    : { ok: false, error: "not_found", status: 404 };
}

export async function deleteCollectionRoutePayload(
  userId: string,
  id: number,
): Promise<CollectionRouteResult> {
  const ok = await deleteCollection(userId, id);
  return ok
    ? { ok: true, payload: {} }
    : { ok: false, error: "not_found", status: 404 };
}
