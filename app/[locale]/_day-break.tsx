"use client";
import { useTweaks } from "@/hooks/use-tweaks";

const ZH_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * Terminal-style day separator with bilingual date label.
 *
 * Both the ISO string and the CJK label are built from local date
 * components on purpose — `groupByDay` in the feed parents group stories
 * by local year/month/day, so the separator must match. Mixing
 * `toISOString()` (UTC) with `getFullYear()/getMonth()/getDate()` (local)
 * made stories published around UTC midnight render with two different
 * dates side-by-side (e.g. "2026-04-17 · 星期四  2026年4月16日").
 */
export function DayBreak({ date }: { date: Date }) {
  const { tweaks } = useTweaks();
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const weekdayEn = date.toLocaleDateString("en-US", { weekday: "short" });
  const weekdayZh = `星期${ZH_WEEKDAYS[date.getDay()]}`;
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
