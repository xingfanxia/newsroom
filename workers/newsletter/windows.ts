import {
  DAILY_NEWSLETTER_KIND,
  MONTHLY_NEWSLETTER_KIND,
  type NewsletterKind,
} from "@/lib/types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DAILY_COLUMN_RUN_HOUR_UTC = 5;

export type NewsletterWindow = {
  start: Date;
  end: Date;
};

export function computeNewsletterWindow(
  kind: NewsletterKind,
  now: Date = new Date(),
): NewsletterWindow {
  if (kind === DAILY_NEWSLETTER_KIND) return computeDailyNewsletterWindow(now);
  if (kind === MONTHLY_NEWSLETTER_KIND) return computeMonthlyNewsletterWindow(now);
  const _exhaustive: never = kind;
  return _exhaustive;
}

export function computeDailyNewsletterWindow(now: Date): NewsletterWindow {
  const end = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
    ),
  );
  return { start: new Date(end.getTime() - DAY_MS), end };
}

export function computeMonthlyNewsletterWindow(now: Date): NewsletterWindow {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return { start: new Date(end.getTime() - 30 * DAY_MS), end };
}

export function runTimeForDailyPeriodStart(periodStart: string | Date): Date {
  const start =
    periodStart instanceof Date ? periodStart : new Date(periodStart);
  return new Date(start.getTime() + DAY_MS);
}

export function runTimeForDailyColumnDate(date: string): Date {
  return new Date(
    `${date}T${String(DAILY_COLUMN_RUN_HOUR_UTC).padStart(2, "0")}:00:00Z`,
  );
}

export function previousDailyColumnRunTimes(
  count: number,
  now: Date = new Date(),
): Date[] {
  const todayRunTime = runTimeForDailyColumnDate(now.toISOString().slice(0, 10));
  return Array.from(
    { length: count },
    (_, idx) => new Date(todayRunTime.getTime() - (idx + 1) * DAY_MS),
  );
}
