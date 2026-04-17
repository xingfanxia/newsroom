import { NextResponse } from "next/server";
import { runEnrichBatch } from "@/workers/enrich";
import { runCommentaryBackfill } from "@/workers/enrich/commentary";
import { runScoreBackfill } from "@/workers/enrich/score-backfill";
import { runArticleBodyFetch } from "@/workers/fetcher/article-body";
import { runYoutubeTranscriptFetch } from "@/workers/fetcher/youtube-transcript";
import { verifyCron } from "../_auth";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  // Fetch full article markdown + YouTube transcripts BEFORE enrich so
  // the LLM sees real content instead of just RSS title + description.
  // The two workers hit different sources (Jina Reader vs youtube-transcript)
  // so running them in parallel doesn't contend for rate-limit budget.
  const [articleBody, youtubeTranscript] = await Promise.all([
    runArticleBodyFetch(),
    runYoutubeTranscriptFetch(),
  ]);
  const enrich = await runEnrichBatch();
  // Score backfill first — populates hkr for pre-schema items so commentary
  // backfill then picks them up under the new tier gate (non-excluded).
  const score = await runScoreBackfill();
  const commentary = await runCommentaryBackfill();
  return NextResponse.json({
    kind: "enrich",
    at: new Date().toISOString(),
    articleBody,
    youtubeTranscript,
    enrich,
    score,
    commentary,
  });
}
