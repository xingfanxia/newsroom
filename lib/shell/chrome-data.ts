import { unstable_cache } from "next/cache";
import {
  derivePulseData,
  deriveRadarStats,
  type PublicPulsePoint,
} from "@/lib/public-content/derive";
import { supportsDirectPublicRouteReads } from "@/lib/public-content/direct-route-read";
import {
  materializedPageLogicalName,
  readScopedMaterializedPageModel,
} from "@/lib/public-content/materialized-artifact";
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
  const scoped = await publicSnapshotReader().readReleaseScoped(async (scope) => {
    if (!supportsDirectPublicRouteReads(scope.release)) {
      const snapshot = await scope.readCanonicalState();
      return shellChromeDataFromSnapshot(snapshot.state, Date.now(), opts);
    }
    const published = await readScopedMaterializedPageModel<{
      chrome: ShellChromeData;
    }>(scope, materializedPageLogicalName.agents);
    const signalRatio =
      opts.signalRatio === "fromRadar"
        ? signalRatioFromRadar(published.chrome.radarStats)
        : opts.signalRatio;
    return {
      radarStats: published.chrome.radarStats,
      topBarStats:
        signalRatio == null
          ? published.chrome.topBarStats
          : topBarStatsFromRadar(published.chrome.radarStats, signalRatio),
      ...(opts.pulse ? { pulse: published.chrome.pulse ?? [] } : {}),
    };
  });
  return scoped.value;
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
 * cached. New releases read the tiny release-pinned agents view; legacy
 * releases retain the scoped canonical fallback. Admin data continues to
 * come from Turso and no longer waits for public canonical hydration.
 */
export async function getShellChromeData(
  opts: ShellChromeOptions = {},
): Promise<ShellChromeData> {
  return readCachedChrome(opts.pulse ?? false, opts.signalRatio);
}
