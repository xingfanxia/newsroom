import { getRadarStats } from "@/lib/shell/dashboard-stats";
import { topBarStatsFromRadar } from "@/lib/shell/top-bar-stats";

/**
 * Admin chrome is intentionally Turso-backed. Operator pages already depend
 * on Turso for their primary data and must not gain an R2/public-release
 * availability dependency merely to render the shared top bar.
 */
export async function getAdminShellChromeData() {
  const radarStats = await getRadarStats();
  return {
    radarStats,
    topBarStats: topBarStatsFromRadar(radarStats),
  };
}
