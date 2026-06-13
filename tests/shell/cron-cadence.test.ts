import { describe, expect, it } from "bun:test";
import {
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
      "~15m cadence",
    );
    expect(snapshots.find((c) => c.name === "newsletter-daily")?.next).toBe(
      "~24h cadence",
    );
    expect(snapshots.every((c) => c.last === "—")).toBe(true);
  });

  it("adds optional last-activity labels without changing schedule ownership", () => {
    const snapshots = systemCronSnapshots(
      {
        "fetch-hourly": new Date("2026-06-13T10:30:00.000Z"),
        "score-backfill": null,
      },
      new Date("2026-06-13T11:36:00.000Z"),
    );

    expect(snapshots.find((c) => c.name === "fetch-hourly")?.last).toBe(
      "1h ago",
    );
    expect(snapshots.find((c) => c.name === "score-backfill")?.last).toBe(
      "no signal",
    );
    expect(snapshots.find((c) => c.name === "newsletter-daily")?.last).toBe(
      "—",
    );
  });
});
