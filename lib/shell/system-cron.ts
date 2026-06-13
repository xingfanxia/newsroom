import vercelConfig from "@/vercel.json";

export type SystemCron = {
  name: string;
  schedule: string;
  next: string;
  last: string;
};

export type SystemCronActivityByName = Record<
  string,
  Date | string | null | undefined
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
        ? formatCronLastActivity(activityByName[name], now)
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

function formatCronLastActivity(
  value: Date | string | null | undefined,
  now: Date,
): string {
  const date = coerceDate(value);
  if (!date) return "no signal";

  const ms = Math.max(0, now.getTime() - date.getTime());
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function coerceDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
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
