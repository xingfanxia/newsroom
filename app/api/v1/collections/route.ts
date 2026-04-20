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
import { z } from "zod";
import { requireApiToken } from "@/lib/auth/api-token";
import {
  createCollection,
  deleteCollection,
  listCollections,
  updateCollection,
} from "@/lib/items/collections";
import { upsertAppUser } from "@/lib/auth/session";

const createSchema = z.object({
  name: z.string().min(1).max(64),
  name_cjk: z.string().max(64).optional().nullable(),
  pinned: z.boolean().optional(),
});
const updateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(64).optional(),
  name_cjk: z.string().max(64).optional().nullable(),
  pinned: z.boolean().optional(),
});
const deleteSchema = z.object({ id: z.number().int().positive() });

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
  const parsed = createSchema.safeParse(raw);
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
      name: parsed.data.name,
      nameCjk: parsed.data.name_cjk ?? null,
      pinned: parsed.data.pinned ?? false,
    });
    return Response.json({ collection });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate|unique/i.test(msg)) {
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
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const ok = await updateCollection({
      userId: user.id,
      id: parsed.data.id,
      name: parsed.data.name,
      nameCjk: parsed.data.name_cjk ?? undefined,
      pinned: parsed.data.pinned,
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
  const parsed = deleteSchema.safeParse(raw);
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
