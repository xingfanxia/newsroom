import { describe, expect, test } from "bun:test";
import {
  computeDailyNewsletterWindow,
  computeMonthlyNewsletterWindow,
  computeNewsletterWindow,
  previousDailyColumnRunTimes,
  runTimeForDailyColumnDate,
  runTimeForDailyPeriodStart,
} from "@/workers/newsletter/windows";

describe("newsletter windows", () => {
  test("computes the daily 24h window snapped to the UTC hour", () => {
    const window = computeDailyNewsletterWindow(
      new Date("2026-04-25T10:30:45Z"),
    );

    expect(window.end.toISOString()).toBe("2026-04-25T10:00:00.000Z");
    expect(window.start.toISOString()).toBe("2026-04-24T10:00:00.000Z");
  });

  test("keeps daily windows idempotent within the same UTC hour", () => {
    const a = computeNewsletterWindow(
      "daily",
      new Date("2026-04-25T10:00:00Z"),
    );
    const b = computeNewsletterWindow(
      "daily",
      new Date("2026-04-25T10:59:59Z"),
    );

    expect(a.start.getTime()).toBe(b.start.getTime());
    expect(a.end.getTime()).toBe(b.end.getTime());
  });

  test("computes the monthly 30d window snapped to the UTC day", () => {
    const window = computeMonthlyNewsletterWindow(
      new Date("2026-04-25T10:30:45Z"),
    );

    expect(window.end.toISOString()).toBe("2026-04-25T00:00:00.000Z");
    expect(window.start.toISOString()).toBe("2026-03-26T00:00:00.000Z");
  });

  test("converts a daily period start back to the run time that produced it", () => {
    expect(
      runTimeForDailyPeriodStart("2026-04-24T10:00:00.000Z").toISOString(),
    ).toBe("2026-04-25T10:00:00.000Z");
  });

  test("computes the standard 05:00Z daily-column run time for a UTC date", () => {
    expect(runTimeForDailyColumnDate("2026-04-25").toISOString()).toBe(
      "2026-04-25T05:00:00.000Z",
    );
  });

  test("lists previous daily-column run times from the standard 05:00Z anchor", () => {
    expect(
      previousDailyColumnRunTimes(2, new Date("2026-04-25T22:30:00Z")).map(
        (d) => d.toISOString(),
      ),
    ).toEqual(["2026-04-24T05:00:00.000Z", "2026-04-23T05:00:00.000Z"]);
  });
});
