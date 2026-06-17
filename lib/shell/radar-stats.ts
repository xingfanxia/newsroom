export type RadarStats = {
  items_today: number;
  items_p1: number;
  items_featured: number;
  tracked_sources: number;
};

export const EMPTY_RADAR_STATS = {
  items_today: 0,
  items_p1: 0,
  items_featured: 0,
  tracked_sources: 0,
} satisfies RadarStats;
