import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { rawItems, items } from "@/db/schema";
import type { RawItem } from "@/db/schema";
import { canonicalizeUrl } from "./canonical";
import { contentHash, stripHtml } from "./readability";

const MAX_PER_RUN = 200;

export type NormalizeReport = {
  processed: number;
  created: number;
  dedupedByHash: number;
  skipped: number; // raw rows with no valid url / body
  errored: number;
  errors: { rawItemId: number; error: string }[];
  durationMs: number;
};

/**
 * Convert newly-fetched raw_items into clean, canonicalized items.
 *
 * Atomicity note: the "insert item → mark raw normalized" pair is NOT wrapped
 * in a DB transaction (Neon HTTP driver doesn't support them). The pair is
 * idempotent-on-replay because:
 *   - item insert uses ON CONFLICT(content_hash) DO NOTHING
 *   - mark-normalized is a conditional UPDATE (only where normalized_at IS NULL)
 * Worst case after a crash: one duplicate insert attempt that is deduped.
 */
export async function runNormalizer(): Promise<NormalizeReport> {
  const started = Date.now();
  const client = db();

  const pending = await client
    .select()
    .from(rawItems)
    .where(isNull(rawItems.normalizedAt))
    .limit(MAX_PER_RUN);

  let created = 0;
  let dedupedByHash = 0;
  let skipped = 0;
  let errored = 0;
  const errors: { rawItemId: number; error: string }[] = [];

  for (const raw of pending) {
    try {
      const outcome = await normalizeOne(raw);
      if (outcome === "created") created++;
      else if (outcome === "deduped") dedupedByHash++;
      else skipped++;
    } catch (err) {
      errored++;
      errors.push({
        rawItemId: raw.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    processed: pending.length,
    created,
    dedupedByHash,
    skipped,
    errored,
    errors,
    durationMs: Date.now() - started,
  };
}

async function normalizeOne(
  raw: RawItem,
): Promise<"created" | "deduped" | "skipped"> {
  const client = db();

  // We require a valid URL to produce an item. If the raw row has no url,
  // skip it — items.url is NOT NULL and using the empty string causes a
  // pathological dedup (all url-less rows hash to the same content_hash).
  const url = (raw.url ?? "").trim();
  if (!url) {
    await markNormalized(raw.id);
    return "skipped";
  }

  const payload = raw.rawPayload as Record<string, unknown>;
  const body =
    extractFromPayload(payload, ["content:encoded"]) ||
    extractFromPayload(payload, ["content"]) ||
    extractFromPayload(payload, ["description"]) ||
    extractFromPayload(payload, ["summary"]) ||
    "";
  const bodyText = stripHtml(body);

  const title = (raw.title ?? "").trim() || "(untitled)";
  const canonical = canonicalizeUrl(url);
  // Include canonical URL in the hash so two url-bearing items never collide,
  // even if their (title, body) happen to coincide (e.g. "(untitled)" / "").
  const hash = contentHash(`${canonical}\n\n${title}`, bodyText);
  const publishedAt = raw.publishedAt ?? new Date();

  const inserted = await client
    .insert(items)
    .values({
      sourceId: raw.sourceId,
      rawItemId: raw.id,
      title,
      body: bodyText,
      url,
      canonicalUrl: canonical,
      contentHash: hash,
      publishedAt,
    })
    .onConflictDoNothing({ target: items.contentHash })
    .returning({ id: items.id });

  await markNormalized(raw.id);
  return inserted.length > 0 ? "created" : "deduped";
}

async function markNormalized(rawId: number) {
  const client = db();
  await client
    .update(rawItems)
    .set({ normalizedAt: new Date() })
    .where(and(eq(rawItems.id, rawId), isNull(rawItems.normalizedAt)));
}

function extractFromPayload(
  payload: Record<string, unknown>,
  keys: string[],
): string {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      if (typeof obj["#text"] === "string") return obj["#text"];
    }
  }
  return "";
}
