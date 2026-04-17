import { NextResponse } from "next/server";
import { runEnrichBatch } from "@/workers/enrich";
import { runCommentaryBackfill } from "@/workers/enrich/commentary";
import { runScoreBackfill } from "@/workers/enrich/score-backfill";
import { runArticleBodyFetch } from "@/workers/fetcher/article-body";
import { verifyCron } from "../_auth";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  // Fetch full article markdown BEFORE enrich so the LLM sees the body,
  // not just the RSS title + description.
  const articleBody = await runArticleBodyFetch();
  const enrich = await runEnrichBatch();
  // Score backfill first — populates hkr for pre-schema items so commentary
  // backfill then picks them up under the new tier gate (non-excluded).
  const score = await runScoreBackfill();
  const commentary = await runCommentaryBackfill();
  return NextResponse.json({
    kind: "enrich",
    at: new Date().toISOString(),
    articleBody,
    enrich,
    score,
    commentary,
  });
}
