/**
 * Production health assessment — pure helpers for the monitor that runs
 * OUTSIDE Vercel (GitHub Actions). Added after the 2026-09-07 incident: a
 * staged CLI production deployment (`vercel deploy --prod --skip-domain`)
 * built from non-app source rebound the project's cron set to a deployment
 * with zero crons, so every cron stopped for ~78h while news.ax0x.ai kept
 * serving the old deployment. A monitor on Vercel Cron would have been
 * switched off by the same failure.
 *
 * Two independent signals:
 *  - cron binding (needs a Vercel token): the cron set is bound to the
 *    deployment that serves production and matches vercel.json;
 *  - freshness (public, no secrets): the R2 public pointer and the latest
 *    daily column keep advancing.
 */

export type CronDefinition = { path: string; schedule: string };

export type VercelProjectCronState = {
  crons?: {
    deploymentId?: string | null;
    disabledAt?: number | null;
    definitions?: CronDefinition[] | null;
  } | null;
  targets?: { production?: { id?: string | null } | null } | null;
};

export type HealthProblem = {
  check: "cron-binding" | "freshness";
  detail: string;
};

/** newsletter-daily starts at 05:00 UTC and retries at 05:20 if missing;
 * both runs end the column window at 05:00. A test pins the schedule. */
export const DAILY_BOUNDARY_UTC_HOUR = 5;
/** 2x the longest gap between enrichments in the 30 days before the incident
 *  (3h) — every enrich queues a publish, so a quiet pointer this old is a stall. */
const MAX_POINTER_AGE_MS = 6 * 60 * 60 * 1000;
/** Columns publish by ~05:05Z and reach R2 by the next :12/:27 tick. */
const DAILY_GRACE_MS = 2 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

function cronKey(def: CronDefinition): string {
  return `${def.path} ${def.schedule}`;
}

export function assessCronBinding(input: {
  project: VercelProjectCronState;
  aliasDeploymentId: string | null;
  expected: readonly CronDefinition[];
}): HealthProblem[] {
  const problems: HealthProblem[] = [];
  const add = (detail: string) =>
    problems.push({ check: "cron-binding", detail });
  const crons = input.project.crons;
  if (!crons) {
    add("project has no cron state — crons are not registered");
    return problems;
  }
  if (crons.disabledAt) add(`crons disabled at ${new Date(crons.disabledAt).toISOString()}`);

  const bound = crons.deploymentId ?? null;
  const production = input.project.targets?.production?.id ?? null;
  if (!bound) add("cron set is not bound to any deployment");
  // An unverifiable comparison is a failure, never a silent pass.
  if (!production) add("project has no production target id — cannot verify the binding");
  if (!input.aliasDeploymentId) {
    add("custom domain alias has no deploymentId — cannot verify what serves production");
  }
  if (bound && production && bound !== production) {
    add(`crons bound to ${bound}, production target is ${production}`);
  }
  if (bound && input.aliasDeploymentId && bound !== input.aliasDeploymentId) {
    add(`crons bound to ${bound}, custom domain serves ${input.aliasDeploymentId}`);
  }

  const actual = new Set((crons.definitions ?? []).map(cronKey));
  const expected = new Set(input.expected.map(cronKey));
  const missing = [...expected].filter((k) => !actual.has(k));
  const extra = [...actual].filter((k) => !expected.has(k));
  if (missing.length > 0) {
    add(`${missing.length}/${expected.size} vercel.json crons not registered: ${missing.join(", ")}`);
  }
  if (extra.length > 0) add(`unexpected registered crons: ${extra.join(", ")}`);
  return problems;
}

/** Latest daily window end that must be public by `now` (05:00Z + grace). */
export function expectedDailyWindowEnd(now: Date): Date {
  const cutoff = new Date(now.getTime() - DAILY_GRACE_MS);
  const boundary = new Date(
    Date.UTC(
      cutoff.getUTCFullYear(),
      cutoff.getUTCMonth(),
      cutoff.getUTCDate(),
      DAILY_BOUNDARY_UTC_HOUR,
    ),
  );
  if (boundary.getTime() > cutoff.getTime()) {
    boundary.setUTCDate(boundary.getUTCDate() - 1);
  }
  return boundary;
}

function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function assessFreshness(input: {
  now: Date;
  pointerPublishedAt: string | null;
  latestDailyWindowEnd: string | null;
}): HealthProblem[] {
  const problems: HealthProblem[] = [];
  const add = (detail: string) => problems.push({ check: "freshness", detail });

  const pointer = parseInstant(input.pointerPublishedAt);
  if (!pointer) {
    add(`public pointer publishedAt missing or invalid (${input.pointerPublishedAt})`);
  } else if (input.now.getTime() - pointer.getTime() > MAX_POINTER_AGE_MS) {
    const hours = ((input.now.getTime() - pointer.getTime()) / HOUR_MS).toFixed(1);
    add(`public snapshot last published ${pointer.toISOString()} (${hours}h ago)`);
  }

  const windowEnd = parseInstant(input.latestDailyWindowEnd);
  const expected = expectedDailyWindowEnd(input.now);
  if (!windowEnd) {
    add(`latest daily window_end missing or invalid (${input.latestDailyWindowEnd})`);
  } else if (windowEnd.getTime() < expected.getTime()) {
    add(`latest daily column window ends ${windowEnd.toISOString()}, expected ${expected.toISOString()}`);
  }
  return problems;
}
