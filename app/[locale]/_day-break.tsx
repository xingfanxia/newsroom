"use client";
import { useTweaks } from "@/hooks/use-tweaks";

const ZH_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** Terminal-style day separator with bilingual date label. */
export function DayBreak({ date }: { date: Date }) {
  const { tweaks } = useTweaks();
  const iso = date.toISOString().slice(0, 10);
  const weekdayEn = date.toLocaleDateString("en-US", { weekday: "short" });
  const weekdayZh = `星期${ZH_WEEKDAYS[date.getDay()]}`;
  const label = tweaks.language === "zh" ? weekdayZh : weekdayEn;
  const cjkDate = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  return (
    <div className="daybreak">
      <span className="date">
        {iso} · {label}
      </span>
      <span className="cn">{cjkDate}</span>
    </div>
  );
}
