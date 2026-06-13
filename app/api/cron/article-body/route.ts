import { runContentPrefetch } from "@/workers/fetcher/content-prefetch";
import { runCronJsonRoute } from "../_route";

// Article body / transcript prefetch — split out of /api/cron/enrich so
// it doesn't eat the enrich function's budget. Jina (HTTP fetch) and
// youtube-transcript (HTTP fetch) hit different upstreams, so running
// them in parallel doesn't contend for rate budget. They write
// `body_md` / transcripts which the next /api/cron/enrich tick consumes.
export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return runCronJsonRoute(req, async () => {
    const report = await runContentPrefetch();
    return {
      kind: "article-body",
      articleBody: report.articleBody,
      youtubeTranscript: report.youtubeTranscript,
    };
  });
}
