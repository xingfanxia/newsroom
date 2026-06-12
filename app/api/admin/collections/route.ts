import { NextResponse } from "next/server";
import { upsertAppUser } from "@/lib/auth/session";
import { requireAdminForRoute } from "@/lib/api/admin-auth";
import {
  createCollection,
  listCollections,
  updateCollection,
  deleteCollection,
} from "@/lib/items/collections";
import {
  adminCollectionCreateBodySchema,
  adminCollectionUpdateBodySchema,
  collectionDeleteBodySchema,
  isDuplicateCollectionNameError,
} from "@/lib/api/collection-requests";

/** GET — list user's collections (used on the saved page + move dialog). */
export async function GET() {
  const auth = await requireAdminForRoute();
  if (!auth.ok) return auth.response;
  const user = auth.admin;

  await upsertAppUser(user);
  const collections = await listCollections(user.id);
  return NextResponse.json({ ok: true, collections });
}

/** POST — create a new collection. */
export async function POST(req: Request) {
  const auth = await requireAdminForRoute();
  if (!auth.ok) return auth.response;
  const user = auth.admin;

  await upsertAppUser(user);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = adminCollectionCreateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const collection = await createCollection({
      userId: user.id,
      ...parsed.data,
    });
    return NextResponse.json({ ok: true, collection });
  } catch (err) {
    if (isDuplicateCollectionNameError(err)) {
      return NextResponse.json(
        { ok: false, error: "duplicate_name" },
        { status: 409 },
      );
    }
    console.error("[api/admin/collections POST] failed", err);
    return NextResponse.json(
      { ok: false, error: "server_error" },
      { status: 500 },
    );
  }
}

/** PATCH — rename / pin / unpin. */
export async function PATCH(req: Request) {
  const auth = await requireAdminForRoute();
  if (!auth.ok) return auth.response;
  const user = auth.admin;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = adminCollectionUpdateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const ok = await updateCollection({
      userId: user.id,
      ...parsed.data,
    });
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/admin/collections PATCH] failed", err);
    return NextResponse.json(
      { ok: false, error: "server_error" },
      { status: 500 },
    );
  }
}

/** DELETE — remove a collection. Saves get reparented to inbox (SET NULL). */
export async function DELETE(req: Request) {
  const auth = await requireAdminForRoute();
  if (!auth.ok) return auth.response;
  const user = auth.admin;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = collectionDeleteBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 },
    );
  }
  const ok = await deleteCollection(user.id, parsed.data.id);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
