import { describe, expect, it } from "bun:test";
import {
  assessCronBinding,
  assessFreshness,
  DAILY_BOUNDARY_UTC_HOUR,
  expectedDailyWindowEnd,
  type CronDefinition,
} from "@/lib/ops/production-health";
import { readSource } from "@/tests/helpers/source";

const EXPECTED: CronDefinition[] = [
  { path: "/api/cron/enrich", schedule: "5,20,35,50 * * * *" },
  { path: "/api/cron/newsletter-daily", schedule: "0 5 * * *" },
];
const PROD = "dpl_prod";

describe("assessCronBinding", () => {
  it("passes when crons are bound to the serving production deployment", () => {
    expect(
      assessCronBinding({
        project: {
          crons: { deploymentId: PROD, disabledAt: null, definitions: [...EXPECTED] },
          targets: { production: { id: PROD } },
        },
        aliasDeploymentId: PROD,
        expected: EXPECTED,
      }),
    ).toEqual([]);
  });

  it("flags the 2026-09-07 incident: crons rebound to a staged zero-cron deploy", () => {
    const problems = assessCronBinding({
      project: {
        crons: { deploymentId: "dpl_9MDN", disabledAt: null, definitions: [] },
        targets: { production: { id: PROD } },
      },
      aliasDeploymentId: PROD,
      expected: EXPECTED,
    });
    const details = problems.map((p) => p.detail).join("\n");
    expect(problems.every((p) => p.check === "cron-binding")).toBe(true);
    expect(details).toContain("production target is dpl_prod");
    expect(details).toContain("custom domain serves dpl_prod");
    expect(details).toContain("2/2 vercel.json crons not registered");
  });

  it("flags a schedule drift even when the deployment ids agree", () => {
    const problems = assessCronBinding({
      project: {
        crons: {
          deploymentId: PROD,
          definitions: [EXPECTED[0]!, { path: "/api/cron/newsletter-daily", schedule: "0 6 * * *" }],
        },
        targets: { production: { id: PROD } },
      },
      aliasDeploymentId: PROD,
      expected: EXPECTED,
    });
    expect(problems.map((p) => p.detail)).toEqual([
      "1/2 vercel.json crons not registered: /api/cron/newsletter-daily 0 5 * * *",
      "unexpected registered crons: /api/cron/newsletter-daily 0 6 * * *",
    ]);
  });

  it("fails when the production target or alias id is missing instead of passing", () => {
    const problems = assessCronBinding({
      project: {
        crons: { deploymentId: "dpl_staged", definitions: [...EXPECTED] },
        targets: { production: null },
      },
      aliasDeploymentId: null,
      expected: EXPECTED,
    });
    expect(problems.map((p) => p.detail)).toEqual([
      "project has no production target id — cannot verify the binding",
      "custom domain alias has no deploymentId — cannot verify what serves production",
    ]);
  });

  it("flags disabled or missing cron state", () => {
    expect(
      assessCronBinding({ project: {}, aliasDeploymentId: PROD, expected: EXPECTED })[0]
        ?.detail,
    ).toContain("no cron state");
    const disabled = assessCronBinding({
      project: {
        crons: { deploymentId: PROD, disabledAt: Date.UTC(2026, 8, 7), definitions: [...EXPECTED] },
        targets: { production: { id: PROD } },
      },
      aliasDeploymentId: PROD,
      expected: EXPECTED,
    });
    expect(disabled.map((p) => p.detail)).toEqual([
      "crons disabled at 2026-09-07T00:00:00.000Z",
    ]);
  });
});

describe("expectedDailyWindowEnd", () => {
  it("expects yesterday's 05:00Z column until the grace after today's boundary", () => {
    expect(expectedDailyWindowEnd(new Date("2026-09-10T06:59:00Z")).toISOString()).toBe(
      "2026-09-09T05:00:00.000Z",
    );
    expect(expectedDailyWindowEnd(new Date("2026-09-10T07:00:00Z")).toISOString()).toBe(
      "2026-09-10T05:00:00.000Z",
    );
    expect(expectedDailyWindowEnd(new Date("2026-09-10T02:00:00Z")).toISOString()).toBe(
      "2026-09-09T05:00:00.000Z",
    );
  });

  it("matches the newsletter-daily schedule in vercel.json", () => {
    const vercel = JSON.parse(readSource("vercel.json")) as {
      crons: CronDefinition[];
    };
    const daily = vercel.crons.find((c) => c.path === "/api/cron/newsletter-daily");
    expect(daily?.schedule).toBe(`0 ${DAILY_BOUNDARY_UTC_HOUR} * * *`);
  });
});

describe("assessFreshness", () => {
  const now = new Date("2026-09-10T19:58:00Z");

  it("passes with a recent pointer and today's column", () => {
    expect(
      assessFreshness({
        now,
        pointerPublishedAt: "2026-09-10T19:42:00Z",
        latestDailyWindowEnd: "2026-09-10T05:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("flags the incident state: a 78h-old pointer and a 3-day-old column", () => {
    const problems = assessFreshness({
      now,
      pointerPublishedAt: "2026-09-07T13:28:01.802Z",
      latestDailyWindowEnd: "2026-09-07T05:00:00.000Z",
    });
    expect(problems.map((p) => p.detail)).toEqual([
      "public snapshot last published 2026-09-07T13:28:01.802Z (78.5h ago)",
      "latest daily column window ends 2026-09-07T05:00:00.000Z, expected 2026-09-10T05:00:00.000Z",
    ]);
  });

  it("treats missing or unparseable signals as problems, never as healthy", () => {
    const problems = assessFreshness({
      now,
      pointerPublishedAt: null,
      latestDailyWindowEnd: "not-a-date",
    });
    expect(problems).toHaveLength(2);
    expect(problems.every((p) => p.check === "freshness")).toBe(true);
  });
});
