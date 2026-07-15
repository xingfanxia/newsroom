import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

export function youtubeVideoUrlSql(urlColumn: SQLWrapper): SQL {
  return sql`(
    ${urlColumn} LIKE '%youtube.com/watch%'
    OR ${urlColumn} LIKE '%youtu.be/%'
    OR ${urlColumn} LIKE '%youtube.com/shorts/%'
    OR ${urlColumn} LIKE '%youtube.com/embed/%'
  )`;
}

function xStatusUrlSql(urlColumn: SQLWrapper): SQL {
  return sql`(
    ${urlColumn} LIKE '%x.com/%/status/%'
    OR ${urlColumn} LIKE '%twitter.com/%/status/%'
  )`;
}

export function articleBodyFetchUrlSql(urlColumn: SQLWrapper): SQL {
  return sql`(
    ${urlColumn} IS NOT NULL
    AND NOT ${youtubeVideoUrlSql(urlColumn)}
    AND NOT ${xStatusUrlSql(urlColumn)}
  )`;
}

export function bodyPrefetchPendingSql(
  bodyFetchedAtColumn: SQLWrapper,
  urlColumn: SQLWrapper,
): SQL {
  return sql`(
    ${bodyFetchedAtColumn} IS NULL
    AND (
      ${articleBodyFetchUrlSql(urlColumn)}
      OR ${youtubeVideoUrlSql(urlColumn)}
    )
  )`;
}

export function enrichBodyPrefetchReadySql(
  bodyFetchedAtColumn: SQLWrapper,
  urlColumn: SQLWrapper,
): SQL {
  return sql`(
    ${bodyFetchedAtColumn} IS NOT NULL
    OR ${xStatusUrlSql(urlColumn)}
  )`;
}
