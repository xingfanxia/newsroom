import { and, eq, isNull, sql } from "drizzle-orm";
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
  errored: number;
  errors: { rawItemId: number; error: string }[];
  durationMs: number;
};

/**
 * Convert newly-fetched raw_items into clean, canonicalized items.
 * - Parses the raw payload (RSS/Atom description or content:encoded)
 * - Canonicalizes URL, computes content hash
 * - Dedupes against existing items via unique content_hash index
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
  let errored = 0;
  const errors: { rawItemId: number; error: string }[] = [];

  for (const raw of pending) {
    try {
      const n = await normalizeOne(raw);
      if (n === "created") created++;
      else if (n === "deduped") dedupedByHash++;
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
    errored,
    errors,
    durationMs: Date.now() - started,
  };
}

async function normalizeOne(raw: RawItem): Promise<"created" | "deduped"> {
  const client = db();
  const payload = raw.rawPayload as Record<string, unknown>;

  // Extract body from common RSS/Atom fields
  const body =
    extractFromPayload(payload, ["content:encoded"]) ||
    extractFromPayload(payload, ["content"]) ||
    extractFromPayload(payload, ["description"]) ||
    extractFromPayload(payload, ["summary"]) ||
    "";
  const bodyText = stripHtml(body);

  const title = raw.title ?? "(untitled)";
  const url = raw.url ?? "";
  const canonical = canonicalizeUrl(url);
  const hash = contentHash(title, bodyText || url);
  const publishedAt = raw.publishedAt ?? new Date(); // fallback to fetch time

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

  // Mark raw row as processed either way
  await client
    .update(rawItems)
    .set({ normalizedAt: new Date() })
    .where(and(eq(rawItems.id, raw.id), isNull(rawItems.normalizedAt)));

  return inserted.length > 0 ? "created" : "deduped";
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

void sql; // keep import; used transitively via schema
