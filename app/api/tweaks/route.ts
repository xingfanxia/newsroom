import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getSessionUser, upsertAppUser } from "@/lib/auth/session";

const tweaksSchema = z.object({
  density: z.enum(["compact", "comfy", "reader"]),
  accent: z.enum(["green", "blue", "purple", "orange", "red", "cyan"]),
  theme: z.enum(["midnight", "obsidian", "slate", "paper"]),
  monoFont: z.enum(["jetbrains", "ibm", "iosevka", "system"]),
  cjkFont: z.enum(["notoSerif", "notoSans", "lxgw"]),
  radius: z.enum(["sharp", "subtle", "soft", "pill"]),
  chromeStyle: z.enum(["terminal", "clean", "brutalist"]),
  scoreStyle: z.enum(["ring", "bar", "tag", "none"]),
  showTicker: z.boolean(),
  showRadar: z.boolean(),
  showPulse: z.boolean(),
  showBreadcrumb: z.boolean(),
  showLineNumbers: z.boolean(),
  mutedMeta: z.boolean(),
  language: z.enum(["zh", "en"]),
});

const bodySchema = z.object({
  tweaks: tweaksSchema.partial().optional(),
  watchlist: z.array(z.string().min(1).max(64)).max(24).optional(),
});

/** GET — return the user's saved tweaks + watchlist (null when not set). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }
  await upsertAppUser(user);

  const [row] = await db()
    .select({ tweaks: users.tweaks, watchlist: users.watchlist })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  return NextResponse.json({
    ok: true,
    tweaks: row?.tweaks ?? null,
    watchlist: (row?.watchlist as string[] | null) ?? null,
  });
}

/** PATCH — save the user's tweaks / watchlist. Either field is optional. */
export async function PATCH(req: Request) {
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
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.tweaks !== undefined) patch.tweaks = parsed.data.tweaks;
  if (parsed.data.watchlist !== undefined) patch.watchlist = parsed.data.watchlist;
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ ok: false, error: "empty_body" }, { status: 400 });
  }

  await db().update(users).set(patch).where(eq(users.id, user.id));
  return NextResponse.json({ ok: true });
}
