"use client";
import { useTweaks } from "@/hooks/use-tweaks";

const ZH_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * Terminal-style day separator with bilingual date label.
 *
 * Takes a UTC-day key string ("YYYY-MM-DD") rather than a Date object
 * because the parent's `groupByDay` keys by UTC day, and Date-based
 * formatting on the client (`new Date("2026-04-24T00:00:00.000Z")`)
 * would render in the client's local TZ — in PDT that's 04-23 evening,
 * shifting the header label one day earlier than the UTC bucket.
 *
 * Parsing the YYYY-MM-DD string + formatting via getUTC* keeps server
 * and client agreed regardless of where they run. Item-level wall-clock
 * times (the "13:00" timestamp on each card) still localize as before;
 * only the day-group label is anchored to UTC.
 */
export function DayBreak({ dayKey }: { dayKey: string }) {
  const { tweaks } = useTweaks();
  const [y, m, d] = dayKey.split("-").map(Number);
  // UTC-anchored Date so getUTC* yields the same calendar fields the key encodes.
  const date = new Date(Date.UTC(y, m - 1, d));
  const iso = dayKey;
  const weekdayEn = date.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  const weekdayZh = `星期${ZH_WEEKDAYS[date.getUTCDay()]}`;
  const zh = tweaks.language === "zh";
  return (
    <div className="daybreak">
      <span className="date">
        {iso} · {zh ? weekdayZh : weekdayEn}
      </span>
      {zh && <span className="cn">{`${y}年${m}月${d}日`}</span>}
    </div>
  );
}
