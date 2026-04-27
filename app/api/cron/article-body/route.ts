import { NextResponse } from "next/server";
import { runArticleBodyFetch } from "@/workers/fetcher/article-body";
import { runYoutubeTranscriptFetch } from "@/workers/fetcher/youtube-transcript";
import { verifyCron } from "../_auth";

// Article body / transcript prefetch — split out of /api/cron/enrich so
// it doesn't eat the enrich function's budget. Jina (HTTP fetch) and
// youtube-transcript (HTTP fetch) hit different upstreams, so running
// them in parallel doesn't contend for rate budget. They write
// `body_md` / transcripts which the next /api/cron/enrich tick consumes.
export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  const [articleBody, youtubeTranscript] = await Promise.all([
    runArticleBodyFetch(),
    runYoutubeTranscriptFetch(),
  ]);
  return NextResponse.json({
    kind: "article-body",
    at: new Date().toISOString(),
    articleBody,
    youtubeTranscript,
  });
}
