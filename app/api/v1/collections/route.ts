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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = v1CollectionCreateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = v1CollectionUpdateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = collectionDeleteBodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  try {
    const ok = await deleteCollection(user.id, parsed.data.id);
    if (!ok) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[api/v1/collections DELETE] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
