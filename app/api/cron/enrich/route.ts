import { NextResponse } from "next/server";
import { runEnrichBatch } from "@/workers/enrich";
import { runCommentaryBackfill } from "@/workers/enrich/commentary";
import { verifyCron } from "../_auth";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  const enrich = await runEnrichBatch();
  // Sweep for featured/p1 items whose Stage-4 commentary failed on their
  // enrich pass so they don't permanently display without the editor note.
  const commentary = await runCommentaryBackfill();
  return NextResponse.json({
    kind: "enrich",
    at: new Date().toISOString(),
    enrich,
    commentary,
  });
}
