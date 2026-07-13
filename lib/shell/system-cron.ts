import vercelConfig from "@/vercel.json";
import { formatCompactRelativeTime } from "@/lib/time/relative";

export type SystemCron = {
  name: string;
  schedule: string;
  next: string;
  last: string;
};

export const NO_DURABLE_CRON_ACTIVITY_SIGNAL = null;
export const NO_DURABLE_CRON_ACTIVITY_LABEL = "no signal";

type NoDurableCronActivitySignal = typeof NO_DURABLE_CRON_ACTIVITY_SIGNAL;

export type SystemCronActivityByName = Record<
  string,
  Date | string | NoDurableCronActivitySignal | undefined
>;

type VercelCronConfig = {
  path: string;
  schedule: string;
};

const CRON_ROUTE_PREFIX = /^\/api\/cron\//;

export function systemCronSnapshots(
  activityByName: SystemCronActivityByName = {},
  now = new Date(),
): SystemCron[] {
  const crons = (vercelConfig as { crons?: VercelCronConfig[] }).crons ?? [];
  return crons.map((c) => {
    const name = c.path.replace(CRON_ROUTE_PREFIX, "");
    const minutes = cadenceMinutesFromCron(c.schedule);
    const hasActivitySignal = Object.prototype.hasOwnProperty.call(
      activityByName,
      name,
    );
    return {
      name,
      schedule: c.schedule,
      next: `~${cadenceLabel(minutes)} cadence`,
      last: hasActivitySignal
        ? formatCompactRelativeTime(activityByName[name], {
            now,
            nullLabel: NO_DURABLE_CRON_ACTIVITY_LABEL,
          })
        : "—",
    };
  });
}

export function cadenceMinutesFromCron(schedule: string): number | null {
  const [minute, hour, dayOfMonth, month, dayOfWeek, extra] = schedule
    .trim()
    .split(/\s+/);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek || extra) {
    return null;
  }

  if (month !== "*") return null;

  const minuteInterval = evenlySpacedInterval(minute, 60);
  if (
    minuteInterval !== null &&
    hour === "*" &&
    dayOfMonth === "*" &&
    dayOfWeek === "*"
  ) {
    return minuteInterval;
  }

  if (!isSingleNumber(minute)) return null;

  if (hour === "*" && dayOfMonth === "*" && dayOfWeek === "*") return 60;

  const hourStep = stepEvery(hour);
  if (hourStep !== null && dayOfMonth === "*" && dayOfWeek === "*") {
    return hourStep * 60;
  }

  // Evenly-spaced hour list, e.g. "4,12,20" → every 8h (phased so a run can land
  // just before a time-sensitive consumer like newsletter-daily at 05:00). Same
  // even-spacing rule as the minute list, cycle = 24h.
  const hourInterval = evenlySpacedInterval(hour, 24);
  if (hourInterval !== null && dayOfMonth === "*" && dayOfWeek === "*") {
    return hourInterval * 60;
  }

  if (!isSingleNumber(hour)) return null;
  if (dayOfMonth === "*" && dayOfWeek === "*") return 60 * 24;
  if (dayOfMonth === "*" && isSingleNumber(dayOfWeek)) return 60 * 24 * 7;
  if (dayOfMonth === "1" && dayOfWeek === "*") return 60 * 24 * 30;

  return null;
}

function cadenceLabel(minutes: number | null): string {
  if (!minutes) return "configured";
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`;
  return `${minutes}m`;
}

function evenlySpacedInterval(field: string, cycle: number): number | null {
  const values = field.split(",").map((v) => Number(v));
  if (values.length < 2 || values.some((v) => !Number.isInteger(v))) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const intervals = sorted.map((value, idx) => {
    const next = sorted[(idx + 1) % sorted.length];
    return ((next ?? 0) - value + cycle) % cycle;
  });
  const [first, ...rest] = intervals;
  if (!first || rest.some((interval) => interval !== first)) return null;
  return first;
}

function isSingleNumber(field: string): boolean {
  return /^\d+$/.test(field);
}

function stepEvery(field: string): number | null {
  const match = field.match(/^\*\/(\d+)$/);
  if (!match) return null;
  const step = Number(match[1]);
  return Number.isInteger(step) && step > 0 ? step : null;
}
