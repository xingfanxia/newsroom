import { describe, expect, test } from "bun:test";
import {
  coerceDate,
  formatCoarseRelativeTime,
  formatCompactRelativeTime,
  formatElapsedSince,
  formatFeedItemTime,
  formatLocalizedRelativeTime,
  latestDate,
  toIsoStringOrNull,
} from "@/lib/time/relative";
import { readSource } from "@/tests/helpers/source";

const NOW = new Date("2026-06-13T11:36:00.000Z");
const LOCAL_NOW = new Date(2026, 5, 13, 11, 36);

describe("relative time display helpers", () => {
  test("coerces only valid date-like values", () => {
    expect(coerceDate("2026-06-13T11:00:00.000Z")).toEqual(
      new Date("2026-06-13T11:00:00.000Z"),
    );
    expect(coerceDate(new Date("2026-06-13T11:00:00.000Z"))).toEqual(
      new Date("2026-06-13T11:00:00.000Z"),
    );
    expect(coerceDate("not-a-date")).toBeNull();
    expect(coerceDate(null)).toBeNull();
  });

  test("finds the latest valid date-like value", () => {
    expect(
      latestDate(
        null,
        "not-a-date",
        "2026-06-13T09:00:00.000Z",
        new Date("2026-06-13T10:00:00.000Z"),
      ),
    ).toEqual(new Date("2026-06-13T10:00:00.000Z"));
  });

  test("serializes valid date-like values to nullable ISO strings", () => {
    expect(toIsoStringOrNull("2026-06-13T11:00:00.000Z")).toBe(
      "2026-06-13T11:00:00.000Z",
    );
    expect(toIsoStringOrNull(new Date("2026-06-13T11:00:00.000Z"))).toBe(
      "2026-06-13T11:00:00.000Z",
    );
    expect(toIsoStringOrNull("not-a-date")).toBeNull();
    expect(toIsoStringOrNull(null)).toBeNull();
  });

  test("formats compact relative labels for operational tables", () => {
    expect(
      formatCompactRelativeTime("2026-06-13T11:35:30.000Z", { now: NOW }),
    ).toBe("30s ago");
    expect(
      formatCompactRelativeTime("2026-06-13T11:06:00.000Z", { now: NOW }),
    ).toBe("30m ago");
    expect(
      formatCompactRelativeTime("2026-06-13T10:30:00.000Z", { now: NOW }),
    ).toBe("1h ago");
    expect(
      formatCompactRelativeTime("2026-06-11T10:00:00.000Z", { now: NOW }),
    ).toBe("2d ago");
    expect(formatCompactRelativeTime(null, { nullLabel: "no signal" })).toBe(
      "no signal",
    );
  });

  test("formats coarse relative labels for list rows", () => {
    expect(
      formatCoarseRelativeTime("2026-06-13T11:00:00.000Z", { now: NOW }),
    ).toBe("now");
    expect(
      formatCoarseRelativeTime("2026-06-13T06:00:00.000Z", { now: NOW }),
    ).toBe("5h ago");
    expect(
      formatCoarseRelativeTime("2026-06-11T08:00:00.000Z", { now: NOW }),
    ).toBe("2d ago");
  });

  test("formats feed item time parts with local clock/date and shared relative label", () => {
    expect(
      formatFeedItemTime(new Date(2026, 5, 13, 6, 5), { now: LOCAL_NOW }),
    ).toEqual({
      hh: "06:05",
      date: "06·13",
      ago: "5h ago",
    });
    expect(
      formatFeedItemTime(new Date(2026, 5, 11, 8, 0), { now: LOCAL_NOW }),
    ).toMatchObject({
      ago: "2d ago",
    });
  });

  test("formats localized relative labels for event member drawers", () => {
    expect(
      formatLocalizedRelativeTime("2026-06-13T11:35:30.000Z", {
        now: NOW,
        locale: "zh",
      }),
    ).toBe("刚刚");
    expect(
      formatLocalizedRelativeTime("2026-06-13T11:06:00.000Z", {
        now: NOW,
        locale: "zh",
      }),
    ).toBe("30分钟前");
    expect(
      formatLocalizedRelativeTime("2026-06-13T10:30:00.000Z", {
        now: NOW,
        locale: "zh",
      }),
    ).toBe("1小时前");
    expect(
      formatLocalizedRelativeTime("2026-06-11T10:00:00.000Z", {
        now: NOW,
        locale: "en",
      }),
    ).toBe("2d ago");
  });

  test("supports rounded coarse labels for policy summaries", () => {
    expect(
      formatCoarseRelativeTime("2026-06-13T10:10:00.000Z", {
        now: NOW,
        currentLabel: "just now",
        hourSuffix: " hrs",
        daySuffix: " d",
        rounding: "round",
      }),
    ).toBe("1 hrs ago");
    expect(
      formatCoarseRelativeTime("2026-06-13T11:10:00.000Z", {
        now: NOW,
        currentLabel: "just now",
        hourSuffix: " hrs",
        daySuffix: " d",
        rounding: "round",
      }),
    ).toBe("just now");
  });

  test("formats elapsed durations without an ago suffix", () => {
    expect(formatElapsedSince("2026-06-13T10:00:00.000Z", { now: NOW })).toBe(
      "1h",
    );
    expect(formatElapsedSince("2026-06-11T08:00:00.000Z", { now: NOW })).toBe(
      "2d 3h",
    );
    expect(formatElapsedSince(null)).toBe("—");
  });

  test("feed components delegate time display to shared helpers", () => {
    const item = readSource("components/feed/item.tsx");
    const drawer = readSource("components/feed/signal-drawer.tsx");

    expect(item).toContain("@/lib/time/relative");
    expect(item).toContain("formatFeedItemTime(story.publishedAt)");
    expect(item).not.toContain("function formatTime");

    expect(drawer).toContain("@/lib/time/relative");
    expect(drawer).toContain("formatLocalizedRelativeTime(m.publishedAt");
    expect(drawer).not.toContain("function formatRelative");
    expect(drawer).not.toContain("Date.now() - new Date");
  });
});
