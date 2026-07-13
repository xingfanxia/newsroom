import { NextResponse } from "next/server";
import { revalidateFeedCache } from "@/lib/shell/feed-cache";
import { verifyCron } from "./_auth";

type CronJsonBody = { kind: string } & Record<string, unknown>;

type CronRouteOpts = {
  /** Purge the feed-derived caches (getDayCounts + aggregates) after the job.
   *  Set on the content-mutating crons (enrich / cluster / score-backfill /
   *  normalize) so a newly enriched/clustered/scored/normalized item shows
   *  within one render instead of waiting out FEED_CACHE_TTL. Deliberately NOT
   *  set on:
   *   - fetch buckets — their fresh (un-enriched) items don't enter the
   *     feed/calendar (those gate on enriched_at) until enrich runs. They DO
   *     count immediately toward radar/pulse (raw created_at counts, no
   *     enriched_at gate), but the CACHED value only refreshes on enrich's
   *     15-min heartbeat (or the TTL) — a ≤15-min lag on a coarse 24h counter,
   *     well inside radar tolerance. Leaving them unset preserves cache life.
   *   - commentary / article-body — they write only commentary/body fields that
   *     no cached aggregate reads (the feed shows commentary but is uncached). */
  revalidateFeed?: boolean;
};

export async function runCronJsonRoute<T extends CronJsonBody>(
  req: Request,
  buildBody: () => Promise<T> | T,
  opts?: CronRouteOpts,
): Promise<Response> {
  const deny = verifyCron(req);
  if (deny) return deny;

  const body = await buildBody();
  if (opts?.revalidateFeed) revalidateFeedCache();
  const payload: Record<string, unknown> = { ...body };
  delete payload.kind;
  delete payload.at;

  return NextResponse.json({
    kind: body.kind,
    at: new Date().toISOString(),
    ...payload,
  });
}
