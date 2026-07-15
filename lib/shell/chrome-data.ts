import {
  derivePulseData,
  deriveRadarStats,
  type PublicPulsePoint,
} from "@/lib/public-content/derive";
import { publicSnapshotReader } from "@/lib/public-content/reader";
import type { RadarStats } from "@/lib/shell/radar-stats";
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
  pulse?: PublicPulsePoint[];
};

export function shellChromeDataFromSnapshot(
  value: unknown,
  nowMs: number,
  opts: ShellChromeOptions = {},
): ShellChromeData {
  const radarStats = deriveRadarStats(value, nowMs);
  const pulse = opts.pulse ? derivePulseData(value, nowMs) : undefined;
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

export async function getShellChromeData(
  opts: ShellChromeOptions = {},
): Promise<ShellChromeData> {
  const snapshot = await publicSnapshotReader().readCanonicalState();
  return shellChromeDataFromSnapshot(snapshot.state, Date.now(), opts);
}
