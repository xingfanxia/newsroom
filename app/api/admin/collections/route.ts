import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, upsertAppUser } from "@/lib/auth/session";
import {
  createCollection,
  listCollections,
  updateCollection,
  deleteCollection,
} from "@/lib/items/collections";

const createSchema = z.object({
  name: z.string().min(1).max(64),
  nameCjk: z.string().max(64).optional().nullable(),
  pinned: z.boolean().optional(),
});
const updateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(64).optional(),
  nameCjk: z.string().max(64).optional().nullable(),
  pinned: z.boolean().optional(),
});
const deleteSchema = z.object({ id: z.number().int().positive() });

/** GET — list user's collections (used on the saved page + move dialog). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }
  await upsertAppUser(user);
  const collections = await listCollections(user.id);
  return NextResponse.json({ ok: true, collections });
}

/** POST — create a new collection. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }
  await upsertAppUser(user);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const collection = await createCollection({
      userId: user.id,
      name: parsed.data.name,
      nameCjk: parsed.data.nameCjk ?? null,
      pinned: parsed.data.pinned ?? false,
    });
    return NextResponse.json({ ok: true, collection });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("duplicate") || msg.includes("unique")) {
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
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const ok = await updateCollection({
      userId: user.id,
      id: parsed.data.id,
      name: parsed.data.name,
      nameCjk: parsed.data.nameCjk ?? undefined,
      pinned: parsed.data.pinned,
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
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = deleteSchema.safeParse(raw);
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
