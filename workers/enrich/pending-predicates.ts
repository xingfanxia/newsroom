import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { enrichBodyPrefetchReadySql } from "@/lib/urls/media";

const ENRICH_CLAIM_STALE_MINUTES = 45;
export const ENRICH_MAX_ATTEMPTS = 3;

type EnrichClaimableColumns = {
  enrichedAt: SQLWrapper;
  bodyFetchedAt: SQLWrapper;
  canonicalUrl: SQLWrapper;
  enrichAttempts: SQLWrapper;
  enrichClaimedAt: SQLWrapper;
};

type EnrichClaimableOptions = {
  maxAttempts?: number;
};

export function enrichClaimableSql(
  columns: EnrichClaimableColumns,
  opts: EnrichClaimableOptions = {},
): SQL {
  const maxAttempts = opts.maxAttempts ?? ENRICH_MAX_ATTEMPTS;
  return sql`(
    ${columns.enrichedAt} IS NULL
    AND ${enrichBodyPrefetchReadySql(columns.bodyFetchedAt, columns.canonicalUrl)}
    AND coalesce(${columns.enrichAttempts}, 0) < ${maxAttempts}
    AND (
      ${columns.enrichClaimedAt} IS NULL
      OR ${columns.enrichClaimedAt} < ${Date.now() - ENRICH_CLAIM_STALE_MINUTES * 60_000}
    )
  )`;
}

type ScoreBackfillPendingColumns = {
  enrichedAt: SQLWrapper;
  hkr: SQLWrapper;
  reasoningZh: SQLWrapper;
  reasoningEn: SQLWrapper;
};

export function scoreBackfillPendingSql(
  columns: ScoreBackfillPendingColumns,
): SQL {
  return sql`(
    ${columns.enrichedAt} IS NOT NULL
    AND (
      ${columns.hkr} IS NULL
      OR ${columns.reasoningZh} IS NULL
      OR ${columns.reasoningEn} IS NULL
      OR json_extract(${columns.hkr}, '$.reasonsZh') IS NULL
      OR json_extract(${columns.hkr}, '$.reasonsEn') IS NULL
    )
  )`;
}
