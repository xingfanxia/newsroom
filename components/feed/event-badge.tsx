"use client";

import type { Story } from "@/lib/types";

type Props = {
  story: Story;
  showZh: boolean;
};

/**
 * NEW / STILL DEVELOPING badge for event cards.
 *
 * Renders nothing for "quiet" cards (coverage ≥ 2 but not first-seen-today
 * and not still-developing) — the coverage-chip handles surfacing cross-source
 * coverage in that state. Keep this component pure: no data fetching, all
 * derivation happens from `story` fields already populated by the feed query
 * (see lib/items/live.ts mapper for `firstSeenAt` / `stillDeveloping` /
 * `coverage`).
 */
export function EventBadge({ story, showZh }: Props) {
  const coverage = story.coverage ?? 1;
  const firstSeen = story.firstSeenAt ? new Date(story.firstSeenAt) : null;

  // Midnight UTC for "today" comparison. Matches the server-side date_trunc
  // logic in buildFeedWhere so the badge lines up with the Today view filter.
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const brokeToday = firstSeen && firstSeen >= todayStart;

  if (brokeToday) {
    if (coverage >= 2) {
      return (
        <span className="event-badge event-badge--new">
          {showZh ? `新 · ${coverage} 信源` : `NEW · ${coverage} sources`}
        </span>
      );
    }
    return (
      <span className="event-badge event-badge--new">
        {showZh ? "新" : "NEW"}
      </span>
    );
  }

  if (story.stillDeveloping && firstSeen) {
    const daysSince = Math.max(
      1,
      Math.floor((todayStart.getTime() - firstSeen.getTime()) / 86_400_000),
    );
    return (
      <span className="event-badge event-badge--developing">
        {showZh
          ? `持续报道 · ${daysSince}d`
          : `STILL DEVELOPING · ${daysSince}d`}
      </span>
    );
  }

  return null;
}
