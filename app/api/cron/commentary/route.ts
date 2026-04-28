import { NextResponse } from "next/server";
import { runCommentaryBackfill } from "@/workers/enrich/commentary";
import { verifyCron } from "../_auth";

// Item-level editor-note / analysis backfill — runs against featured/p1
// items with `enriched_at IS NOT NULL`. Each call is ~30-40s of standard
// reasoning, so it gets its own function so the longer wall clock per
// item doesn't starve /api/cron/enrich's per-tick budget.
export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  const commentary = await runCommentaryBackfill();
  return NextResponse.json({
    kind: "commentary",
    at: new Date().toISOString(),
    commentary,
  });
}
