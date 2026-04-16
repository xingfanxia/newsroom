import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Dict<T = unknown> = Record<string, T>;

export function formatRelative(
  date: Date,
  locale: "zh" | "en",
  now: Date = new Date(),
): { kind: "justNow" | "minutes" | "hours" | "days"; value?: number } {
  const diff = (now.getTime() - date.getTime()) / 1000;
  if (diff < 60) return { kind: "justNow" };
  const min = Math.floor(diff / 60);
  if (min < 60) return { kind: "minutes", value: min };
  const hr = Math.floor(diff / 3600);
  if (hr < 24) return { kind: "hours", value: hr };
  const d = Math.floor(diff / 86400);
  return { kind: "days", value: d };
}

export function formatDateHeader(date: Date, locale: "zh" | "en"): string {
  if (locale === "zh") {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
