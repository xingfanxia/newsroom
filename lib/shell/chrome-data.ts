import type { PulsePoint } from "@/components/shell/pulse-box";
import {
  getPulseDataCached,
  getRadarStatsCached,
} from "@/lib/shell/feed-cache";
import { EMPTY_RADAR_STATS, type RadarStats } from "@/lib/shell/radar-stats";
import {
  signalRatioFromRadar,
  topBarStatsFromRadar,
  type TopBarStats,
} from "@/lib/shell/top-bar-stats";

type ShellChromeOptions = {
  pulse?: boolean;
  signalRatio?: number | "fromRadar";
};

export type ShellChromeData = {
  radarStats: RadarStats;
  topBarStats: TopBarStats;
  pulse?: PulsePoint[];
};

export async function getShellChromeData(
  opts: ShellChromeOptions = {},
): Promise<ShellChromeData> {
  const [radarStats, pulse] = await Promise.all([
    getRadarStatsCached().catch(() => EMPTY_RADAR_STATS),
    opts.pulse
      ? getPulseDataCached().catch(() => [])
      : Promise.resolve(undefined),
  ]);

  const signalRatio =
    opts.signalRatio === "fromRadar"
      ? signalRatioFromRadar(radarStats)
      : opts.signalRatio;

  return {
    radarStats,
    topBarStats:
      signalRatio == null
        ? topBarStatsFromRadar(radarStats)
        : topBarStatsFromRadar(radarStats, signalRatio),
    pulse,
  };
}
