export const MAX_WATCHLIST_TERMS = 24;
export const MAX_WATCHLIST_TERM_CHARS = 64;

function normalizeWatchlistTerm(term: string): string | null {
  const normalized = term.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeWatchlist(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of terms) {
    const term = normalizeWatchlistTerm(raw);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    normalized.push(term);
  }

  return normalized;
}

export function limitWatchlist(terms: readonly string[]): string[] {
  return normalizeWatchlist(terms).slice(0, MAX_WATCHLIST_TERMS);
}

export function addWatchlistTerm(
  terms: readonly string[],
  rawTerm: string,
): string[] {
  return limitWatchlist([...terms, rawTerm]);
}

export function removeWatchlistTerm(
  terms: readonly string[],
  rawTerm: string,
): string[] {
  const term = normalizeWatchlistTerm(rawTerm);
  if (!term) return limitWatchlist(terms);
  return limitWatchlist(terms).filter((existing) => existing !== term);
}

export function watchlistsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((term, index) => term === right[index])
  );
}
