import type { RadarStats } from "@/lib/shell/radar-stats";

export type TopBarStats = {
  tracked_sources: number;
  signal_ratio: number;
};

export const DEFAULT_SIGNAL_RATIO = 0.72;

export function signalRatioFromRadar(
  stats: RadarStats,
  fallback = DEFAULT_SIGNAL_RATIO,
): number {
  if (stats.items_today <= 0) return clampSignalRatio(fallback);
  return clampSignalRatio(
    (stats.items_p1 + stats.items_featured) / stats.items_today,
  );
}

export function topBarStatsFromRadar(
  stats: RadarStats,
  signalRatio = DEFAULT_SIGNAL_RATIO,
): TopBarStats {
  return {
    tracked_sources: stats.tracked_sources,
    signal_ratio: clampSignalRatio(signalRatio),
  };
}

function clampSignalRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIGNAL_RATIO;
  return Math.max(0, Math.min(1, value));
}
