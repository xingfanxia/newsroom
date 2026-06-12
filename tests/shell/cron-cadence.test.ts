import { describe, expect, it } from "bun:test";
import { cadenceMinutesFromCron } from "@/lib/shell/system-stats";

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
});
