import { unstable_cache } from "next/cache";
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

async function fetchShellChromeData(
  opts: ShellChromeOptions,
): Promise<ShellChromeData> {
  const snapshot = await publicSnapshotReader().readCanonicalState();
  return shellChromeDataFromSnapshot(snapshot.state, Date.now(), opts);
}

const readCachedChrome = unstable_cache(
  async (
    pulse: boolean,
    signalRatio: number | "fromRadar" | undefined,
  ): Promise<ShellChromeData> => fetchShellChromeData({ pulse, signalRatio }),
  ["shell-chrome:v1"],
  { revalidate: 60, tags: ["shell-chrome"] },
);

/**
 * 60s-cached shell chrome (top-bar stats + optional pulse). ALWAYS
 * cached — the raw path fetches + parses the FULL R2 canonical
 * snapshot per request (2-5s), which made every page that loaded
 * chrome uncached (all admin views, /saved, /newsletter) slow. Chrome
 * is global, tiny after derivation, and tolerant of 60s staleness, so
 * there is deliberately NO uncached public variant to mis-pick.
 */
export async function getShellChromeData(
  opts: ShellChromeOptions = {},
): Promise<ShellChromeData> {
  return readCachedChrome(opts.pulse ?? false, opts.signalRatio);
}
