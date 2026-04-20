/**
 * /api/v1/tweaks — Bearer-gated view + mutation of user preferences +
 * watchlist terms. Mirrors /api/tweaks (cookie-gated) for agents.
 *
 * GET    → { tweaks, watchlist }
 * PATCH  → body { tweaks?, watchlist? } — either field optional
 *
 * Watchlist: array of ≤24 strings, each 1..64 chars. Full replace semantic
 * (no partial deltas) to match the existing UI and make the agent's mental
 * model simple ("I sent [a,b,c] → server state is exactly [a,b,c]").
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireApiToken } from "@/lib/auth/api-token";
import { upsertAppUser } from "@/lib/auth/session";

const tweaksShape = z.object({
  density: z.enum(["compact", "comfy", "reader"]).optional(),
  accent: z
    .enum(["green", "blue", "purple", "orange", "red", "cyan"])
    .optional(),
  theme: z.enum(["midnight", "obsidian", "slate", "paper"]).optional(),
  monoFont: z.enum(["jetbrains", "ibm", "iosevka", "system"]).optional(),
  cjkFont: z.enum(["notoSerif", "notoSans", "lxgw"]).optional(),
  radius: z.enum(["sharp", "subtle", "soft", "pill"]).optional(),
  chromeStyle: z.enum(["terminal", "clean", "brutalist"]).optional(),
  scoreStyle: z.enum(["ring", "bar", "tag", "none"]).optional(),
  showTicker: z.boolean().optional(),
  showRadar: z.boolean().optional(),
  showPulse: z.boolean().optional(),
  showBreadcrumb: z.boolean().optional(),
  showLineNumbers: z.boolean().optional(),
  mutedMeta: z.boolean().optional(),
  language: z.enum(["zh", "en"]).optional(),
});

const patchSchema = z.object({
  tweaks: tweaksShape.optional(),
  watchlist: z.array(z.string().min(1).max(64)).max(24).optional(),
});

export async function GET(req: Request) {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;
  const { user } = auth;

  try {
    await upsertAppUser(user);
    const [row] = await db()
      .select({ tweaks: users.tweaks, watchlist: users.watchlist })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    return Response.json({
      tweaks: row?.tweaks ?? null,
      watchlist: (row?.watchlist as string[] | null) ?? null,
    });
  } catch (err) {
    console.error("[api/v1/tweaks GET] failed", err);
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
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.tweaks !== undefined) patch.tweaks = parsed.data.tweaks;
  if (parsed.data.watchlist !== undefined) patch.watchlist = parsed.data.watchlist;
  if (Object.keys(patch).length === 1) {
    return Response.json({ error: "empty_body" }, { status: 400 });
  }

  try {
    await upsertAppUser(user);
    await db().update(users).set(patch).where(eq(users.id, user.id));
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[api/v1/tweaks PATCH] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
