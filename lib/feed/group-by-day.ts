/**
 * Group feed stories by their UTC calendar day.
 *
 * Returns a `Record<"YYYY-MM-DD" UTC string, T[]>` so server and client
 * agree on which day a story belongs to. Earlier code keyed by a
 * UTC-midnight Date.toISOString() — the server side worked, but the
 * client-side `<DayBreak date={new Date(dayKey)} />` re-parsed that ISO
 * in the client's local TZ and rendered the previous day's evening as
 * the header, so 2026-04-24T03:07Z items showed under "2026-04-23".
 *
 * The TS-side `maxPerDay` cap in `lib/items/live.ts` already uses the
 * same UTC-day slicing (`r.publishedAt.toISOString().slice(0, 10)`),
 * so this matches that grouping convention exactly — clicking a
 * calendar cell shows items from the same UTC day the cell counts.
 *
 * Iteration order preserves insertion order (i.e., the SQL sort), so
 * archive-view (publishedAt DESC) and today-view (importance/heat) both
 * round-trip without re-sorting.
 */
export function groupByDay<T extends { publishedAt: string }>(
  stories: T[],
): Record<string, T[]> {
  const byDay: Record<string, T[]> = {};
  for (const s of stories) {
    // publishedAt is the canonical UTC ISO from getFeaturedStories.
    // slice(0, 10) extracts "YYYY-MM-DD" without parsing — TZ-stable.
    const day = s.publishedAt.slice(0, 10);
    (byDay[day] ??= []).push(s);
  }
  return byDay;
}
