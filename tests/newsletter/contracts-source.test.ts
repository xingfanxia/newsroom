import { describe, expect, test } from "bun:test";
import {
  DAILY_NEWSLETTER_KIND,
  MONTHLY_NEWSLETTER_KIND,
  NEWSLETTER_KINDS,
  NEWSLETTER_LOCALES,
} from "@/lib/types";
import { readSource as read } from "@/tests/helpers/source";

const typesSrc = read("lib/types.ts");
const newsletterWorkerSrc = read("workers/newsletter/index.ts");
const dailyColumnWorkerSrc = read("workers/newsletter/run-daily-column.ts");
const dailyColumnSelectSrc = read("workers/newsletter/select.ts");
const newsletterWindowsSrc = read("workers/newsletter/windows.ts");
const dailyColumnBackfillSrc = read("scripts/ops/backfill-daily-columns.ts");
const dailyColumnRegenSrc = read("scripts/ops/regen-daily-column.ts");
const dailyColumnWeekBackfillSrc = read("scripts/ops/backfill-daily-week.ts");
const dailyColumnApiSrc = read("lib/api/daily-columns.ts");

describe("newsletter runtime contracts", () => {
  test("newsletter kind and locale labels have one runtime source of truth", () => {
    expect(DAILY_NEWSLETTER_KIND).toBe("daily");
    expect(MONTHLY_NEWSLETTER_KIND).toBe("monthly");
    expect(NEWSLETTER_KINDS).toEqual(["daily", "monthly"]);
    expect(NEWSLETTER_LOCALES).toEqual(["zh", "en"]);

    expect(typesSrc).toContain("export const NEWSLETTER_KINDS");
    expect(typesSrc).toContain(
      "export type NewsletterKind = (typeof NEWSLETTER_KINDS)[number]",
    );
    expect(typesSrc).toContain("export const NEWSLETTER_LOCALES");
    expect(typesSrc).toContain("export type NewsletterLocale = AppLocale");
  });

  test("newsletter workers and daily-column API reuse the shared contracts", () => {
    expect(newsletterWorkerSrc).toContain("@/lib/types");
    expect(newsletterWorkerSrc).toContain("NEWSLETTER_LOCALES");
    expect(newsletterWorkerSrc).toContain("DAILY_NEWSLETTER_KIND");
    expect(newsletterWorkerSrc).not.toContain(
      'export type NewsletterKind = "daily" | "monthly"',
    );
    expect(newsletterWorkerSrc).not.toContain(
      'type NewsletterLocale = "zh" | "en"',
    );

    expect(dailyColumnWorkerSrc).toContain("DAILY_NEWSLETTER_KIND");
    expect(dailyColumnApiSrc).toContain("DAILY_NEWSLETTER_KIND");
    expect(dailyColumnApiSrc).toContain("NEWSLETTER_LOCALES");
    expect(dailyColumnApiSrc).toContain("z.enum(NEWSLETTER_LOCALES)");
  });

  test("newsletter workers share window calculations", () => {
    expect(newsletterWindowsSrc).toContain("computeNewsletterWindow");
    expect(newsletterWorkerSrc).toContain("@/workers/newsletter/windows");
    expect(newsletterWorkerSrc).toContain("computeNewsletterWindow(kind, now)");
    expect(newsletterWorkerSrc).not.toContain("function computeWindow");

    expect(dailyColumnSelectSrc).toContain("@/workers/newsletter/windows");
    expect(dailyColumnSelectSrc).toContain("computeDailyNewsletterWindow(now)");

    expect(dailyColumnBackfillSrc).toContain("runTimeForDailyPeriodStart");
    expect(dailyColumnBackfillSrc).not.toContain(
      "new Date(periodStartIso).getTime() + 24 * 60 * 60 * 1000",
    );
    expect(dailyColumnRegenSrc).toContain("runTimeForDailyColumnDate");
    expect(dailyColumnRegenSrc).not.toContain("T05:00:00Z");
    expect(dailyColumnWeekBackfillSrc).toContain("previousDailyColumnRunTimes");
    expect(dailyColumnWeekBackfillSrc).not.toContain("setUTCHours(5");
  });
});
