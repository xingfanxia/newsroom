import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{8,}$/;

export function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split("/")[0];
      return isValidYouTubeId(id) ? id : null;
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      if (parsed.pathname === "/watch") {
        const id = parsed.searchParams.get("v");
        return id && isValidYouTubeId(id) ? id : null;
      }
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?#]+)/);
      if (shortsMatch) {
        return isValidYouTubeId(shortsMatch[1]) ? shortsMatch[1] : null;
      }
      const embedMatch = parsed.pathname.match(/^\/embed\/([^/?#]+)/);
      if (embedMatch) {
        return isValidYouTubeId(embedMatch[1]) ? embedMatch[1] : null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function isYouTubeVideoUrl(url: string): boolean {
  return extractYouTubeId(url) !== null;
}

export function youtubeVideoUrlSql(urlColumn: SQLWrapper): SQL {
  return sql`(
    ${urlColumn} ILIKE '%youtube.com/watch%'
    OR ${urlColumn} ILIKE '%youtu.be/%'
    OR ${urlColumn} ILIKE '%youtube.com/shorts/%'
    OR ${urlColumn} ILIKE '%youtube.com/embed/%'
  )`;
}

function xStatusUrlSql(urlColumn: SQLWrapper): SQL {
  return sql`(
    ${urlColumn} ILIKE '%x.com/%/status/%'
    OR ${urlColumn} ILIKE '%twitter.com/%/status/%'
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

function isValidYouTubeId(id: string): boolean {
  return YOUTUBE_ID_RE.test(id);
}
