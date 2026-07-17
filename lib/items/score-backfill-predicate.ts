import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

type ScoreBackfillPendingColumns = {
  enrichedAt: SQLWrapper;
  hkr: SQLWrapper;
  reasoningZh: SQLWrapper;
  reasoningEn: SQLWrapper;
};

/** Shared by the score worker, admin queue depth, and the matching partial index. */
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
