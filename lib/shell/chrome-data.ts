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

export async function getShellChromeData(
  opts: ShellChromeOptions = {},
): Promise<ShellChromeData> {
  const snapshot = await publicSnapshotReader().readCanonicalState();
  return shellChromeDataFromSnapshot(snapshot.state, Date.now(), opts);
}

const readCachedChrome = unstable_cache(
  async (pulse: boolean): Promise<ShellChromeData> =>
    getShellChromeData({ pulse }),
  ["shell-chrome:v1"],
  { revalidate: 60, tags: ["shell-chrome"] },
);

/**
 * 60s-cached chrome for anonymous public pages. The uncached
 * getShellChromeData fetches + parses the FULL R2 canonical snapshot
 * per request (2-5s) — fine for low-traffic authed admin views, wrong
 * for public routes. Derived chrome is tiny, so cache the derivation
 * like every other anonymous page model does.
 */
export async function getCachedShellChromeData(
  opts: { pulse?: boolean } = {},
): Promise<ShellChromeData> {
  return readCachedChrome(opts.pulse ?? false);
}
