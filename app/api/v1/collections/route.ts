/**
 * /api/v1/collections — Bearer-gated CRUD over saved_collections.
 *
 * Mirrors the admin-cookie-gated /api/admin/collections surface but
 * validates via Bearer token instead. Same underlying helpers so
 * behavior is identical.
 *
 * GET     → list caller's collections
 * POST    → create { name, name_cjk?, pinned? }
 * PATCH   → update  { id, name?, name_cjk?, pinned? }
 * DELETE  → delete  { id }   (cascade-reparents saves to inbox)
 */
import { requireApiToken } from "@/lib/auth/api-token";
import {
  createCollection,
  deleteCollection,
  listCollections,
  updateCollection,
} from "@/lib/items/collections";
import { upsertAppUser } from "@/lib/auth/session";
import {
  collectionDeleteBodySchema,
  isDuplicateCollectionNameError,
  v1CollectionCreateBodySchema,
  v1CollectionUpdateBodySchema,
} from "@/lib/api/collection-requests";
import { parseJsonRequestBody } from "@/lib/api/json-body";

export async function GET(req: Request) {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;
  const { user } = auth;

  try {
    await upsertAppUser(user);
    const collections = await listCollections(user.id);
    return Response.json({ collections, total: collections.length });
  } catch (err) {
    console.error("[api/v1/collections GET] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;
  const { user } = auth;

  const parsed = await parseJsonRequestBody(req, v1CollectionCreateBodySchema, {
    envelope: "plain",
  });
  if (!parsed.ok) return parsed.response;

  try {
    await upsertAppUser(user);
    const collection = await createCollection({
      userId: user.id,
      ...parsed.data,
    });
    return Response.json({ collection });
  } catch (err) {
    if (isDuplicateCollectionNameError(err)) {
      return Response.json({ error: "duplicate_name" }, { status: 409 });
    }
    console.error("[api/v1/collections POST] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;
  const { user } = auth;

  const parsed = await parseJsonRequestBody(req, v1CollectionUpdateBodySchema, {
    envelope: "plain",
  });
  if (!parsed.ok) return parsed.response;

  try {
    const ok = await updateCollection({
      userId: user.id,
      ...parsed.data,
    });
    if (!ok) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[api/v1/collections PATCH] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;
  const { user } = auth;

  const parsed = await parseJsonRequestBody(req, collectionDeleteBodySchema, {
    envelope: "plain",
    includeIssues: false,
  });
  if (!parsed.ok) return parsed.response;

  try {
    const ok = await deleteCollection(user.id, parsed.data.id);
    if (!ok) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[api/v1/collections DELETE] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
