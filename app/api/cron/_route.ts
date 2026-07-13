import { NextResponse } from "next/server";
import { revalidateFeedCache } from "@/lib/shell/feed-cache";
import { verifyCron } from "./_auth";

type CronJsonBody = { kind: string } & Record<string, unknown>;

type CronRouteOpts<T> = {
  /** Purge the cheap feed aggregates after the job. Set on the content-mutating
   *  crons (enrich / cluster / score-backfill / normalize) so a newly enriched/
   *  clustered/scored/normalized item shows within one render instead of waiting
   *  out FEED_CACHE_TTL. (The 60-day calendar counts are NOT purged here — they
   *  ride their own 6h TTL; see feed-cache.ts.) Deliberately NOT set on:
   *   - fetch buckets — their fresh (un-enriched) items don't enter the
   *     feed/calendar (those gate on enriched_at) until enrich runs. They DO
   *     count immediately toward radar/pulse (raw created_at counts, no
   *     enriched_at gate), but the CACHED value only refreshes on enrich's
   *     15-min heartbeat (or the TTL) — a ≤15-min lag on a coarse 24h counter,
   *     well inside radar tolerance. Leaving them unset preserves cache life.
   *   - commentary / article-body — they write only commentary/body fields that
   *     no cached aggregate reads (the feed shows commentary but is uncached).
   *
   *  W9b: pass a PREDICATE `(body) => boolean` to purge only when the run
   *  actually changed feed content (e.g. enrich enriched > 0). An idle tick
   *  (overnight, nothing to enrich) then keeps the aggregate cache warm instead
   *  of forcing a needless re-prime. `true` = always purge (use for crons whose
   *  every run mutates, or where a per-run "changed" signal would be fragile). */
  revalidateFeed?: boolean | ((body: T) => boolean);
};

export async function runCronJsonRoute<T extends CronJsonBody>(
  req: Request,
  buildBody: () => Promise<T> | T,
  opts?: CronRouteOpts<T>,
): Promise<Response> {
  const deny = verifyCron(req);
  if (deny) return deny;

  const body = await buildBody();
  const shouldPurge =
    typeof opts?.revalidateFeed === "function"
      ? opts.revalidateFeed(body)
      : opts?.revalidateFeed === true;
  if (shouldPurge) revalidateFeedCache();
  const payload: Record<string, unknown> = { ...body };
  delete payload.kind;
  delete payload.at;

  return NextResponse.json({
    kind: body.kind,
    at: new Date().toISOString(),
    ...payload,
  });
}
