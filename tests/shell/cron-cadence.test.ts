import { describe, expect, it } from "bun:test";
import {
  NO_DURABLE_CRON_ACTIVITY_LABEL,
  NO_DURABLE_CRON_ACTIVITY_SIGNAL,
  cadenceMinutesFromCron,
  systemCronSnapshots,
} from "@/lib/shell/system-cron";
import vercelConfig from "@/vercel.json";

describe("cadenceMinutesFromCron", () => {
  it("derives common Vercel cron cadences from the schedule expression", () => {
    expect(cadenceMinutesFromCron("17 * * * *")).toBe(60);
    expect(cadenceMinutesFromCron("23 4 * * *")).toBe(60 * 24);
    expect(cadenceMinutesFromCron("43 5 * * 1")).toBe(60 * 24 * 7);
    expect(cadenceMinutesFromCron("37 */6 * * *")).toBe(60 * 6);
    // W9: cluster 3×/day, phased (4,12,20) so 04:55 lands before newsletter 05:00.
    expect(cadenceMinutesFromCron("55 4,12,20 * * *")).toBe(60 * 8);
    expect(cadenceMinutesFromCron("55 */8 * * *")).toBe(60 * 8); // equivalent step form
    expect(cadenceMinutesFromCron("10 */12 * * *")).toBe(60 * 12); // W9: commentary 2×/day
    expect(cadenceMinutesFromCron("0,15,30,45 * * * *")).toBe(15);
    expect(cadenceMinutesFromCron("12,42 * * * *")).toBe(30);
    expect(cadenceMinutesFromCron("37 9 1 * *")).toBe(60 * 24 * 30);
  });

  it("returns null for schedules whose cadence cannot be inferred safely", () => {
    expect(cadenceMinutesFromCron("bad schedule")).toBeNull();
    expect(cadenceMinutesFromCron("0 9 1 1 *")).toBeNull();
    expect(cadenceMinutesFromCron("0,10,25 * * * *")).toBeNull();
  });

  it("builds the admin cron table from vercel.json with cadence labels", () => {
    const expected = (
      (vercelConfig as { crons?: Array<{ path: string; schedule: string }> })
        .crons ?? []
    ).map((c) => ({
      name: c.path.replace(/^\/api\/cron\//, ""),
      schedule: c.schedule,
    }));

    const snapshots = systemCronSnapshots();
    expect(snapshots.map(({ name, schedule }) => ({ name, schedule }))).toEqual(
      expected,
    );
    expect(snapshots.find((c) => c.name === "article-body")?.next).toBe(
      "~1h cadence",
    );
    expect(snapshots.find((c) => c.name === "newsletter-daily")?.next).toBe(
      "~24h cadence",
    );
    expect(snapshots.every((c) => c.last === "—")).toBe(true);
  });

  it("keeps the cluster pipeline no more frequent than hourly (read-budget guard)", () => {
    // Clustering can only work on content the hourly fetch (17 * * * *) has
    // pulled, so sub-hourly ticks re-scan the same corpus for nothing — the
    // top read amplifier (W7). W9 went further: this is a daily-update site, so
    // cluster now runs 3×/day (55 */8 * * * → 480 min) — the ±72h NN pipeline is
    // ~50k reads/tick, so frequency IS the read lever here. This guard fails if
    // the cadence is ever cranked back below 60 min. See
    // docs/FIX-W7-read-budget-2026-07-12.md (A4) and the W9 cadence cut.
    const cluster = (
      (vercelConfig as { crons?: Array<{ path: string; schedule: string }> })
        .crons ?? []
    ).find((c) => c.path === "/api/cron/cluster");
    expect(cluster).toBeDefined();
    const cadence = cadenceMinutesFromCron(cluster!.schedule);
    expect(cadence).not.toBeNull();
    expect(cadence!).toBeGreaterThanOrEqual(60);
  });

  it("adds optional last-activity labels without changing schedule ownership", () => {
    const snapshots = systemCronSnapshots(
      {
        "fetch-hourly": new Date("2026-06-13T10:30:00.000Z"),
        "score-backfill": NO_DURABLE_CRON_ACTIVITY_SIGNAL,
      },
      new Date("2026-06-13T11:36:00.000Z"),
    );

    expect(snapshots.find((c) => c.name === "fetch-hourly")?.last).toBe(
      "1h ago",
    );
    expect(snapshots.find((c) => c.name === "score-backfill")?.last).toBe(
      NO_DURABLE_CRON_ACTIVITY_LABEL,
    );
    expect(snapshots.find((c) => c.name === "newsletter-daily")?.last).toBe(
      "—",
    );
  });
});
