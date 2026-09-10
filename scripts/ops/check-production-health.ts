/**
 * Production health monitor — runs hourly from GitHub Actions (NEVER Vercel
 * Cron: the failure it guards against switches Vercel crons off). Exits 1 on
 * any problem so GitHub emails the owner.
 *
 *  - freshness (no secrets): R2 public pointer publishedAt + latest public
 *    daily column window_end;
 *  - cron binding (VERCEL_TOKEN): project crons bound to the deployment that
 *    serves news.ax0x.ai and matching vercel.json. Logged as SKIPPED when the
 *    token is absent.
 *
 * Run:   bun scripts/ops/check-production-health.ts
 * Recovery runbook: docs/operations/production-monitoring.md
 */
import { readFileSync } from "node:fs";
import {
  assessCronBinding,
  assessFreshness,
  type CronDefinition,
  type HealthProblem,
  type VercelProjectCronState,
} from "@/lib/ops/production-health";

const SITE_ORIGIN = process.env.HEALTH_SITE_ORIGIN ?? "https://news.ax0x.ai";
const POINTER_URL =
  process.env.HEALTH_POINTER_URL ??
  "https://content.ax0x.ai/newsroom/v1/current.json";
const VERCEL_TEAM_SLUG = process.env.VERCEL_TEAM_SLUG ?? "panpanmao";
const VERCEL_PROJECT = process.env.VERCEL_PROJECT ?? "newsroom";
const PRODUCTION_DOMAIN = new URL(SITE_ORIGIN).hostname;
const TIMEOUT_MS = 20_000;

async function getJson(url: string, token?: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.json();
}

function expectedCrons(): CronDefinition[] {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons?: CronDefinition[];
  };
  if (!config.crons?.length) throw new Error("vercel.json declares no crons");
  return config.crons.map(({ path, schedule }) => ({ path, schedule }));
}

async function checkFreshness(now: Date): Promise<HealthProblem[]> {
  const pointer = (await getJson(`${POINTER_URL}?_=${now.getTime()}`)) as {
    publishedAt?: string;
  };
  const daily = (await getJson(
    `${SITE_ORIGIN}/api/public/daily?locale=zh&_=${now.getTime()}`,
  )) as { window_end?: string };
  console.log(
    `freshness: pointer publishedAt=${pointer.publishedAt} · daily window_end=${daily.window_end}`,
  );
  return assessFreshness({
    now,
    pointerPublishedAt: pointer.publishedAt ?? null,
    latestDailyWindowEnd: daily.window_end ?? null,
  });
}

async function checkCronBinding(token: string): Promise<HealthProblem[]> {
  const api = "https://api.vercel.com";
  const scope = `slug=${encodeURIComponent(VERCEL_TEAM_SLUG)}`;
  const project = (await getJson(
    `${api}/v9/projects/${encodeURIComponent(VERCEL_PROJECT)}?${scope}`,
    token,
  )) as VercelProjectCronState;
  const alias = (await getJson(
    `${api}/v4/aliases/${encodeURIComponent(PRODUCTION_DOMAIN)}?${scope}`,
    token,
  )) as { deploymentId?: string };
  console.log(
    `cron-binding: crons→${project.crons?.deploymentId} (${project.crons?.definitions?.length ?? 0} defs) · production→${project.targets?.production?.id} · ${PRODUCTION_DOMAIN}→${alias.deploymentId}`,
  );
  return assessCronBinding({
    project,
    aliasDeploymentId: alias.deploymentId ?? null,
    expected: expectedCrons(),
  });
}

async function main() {
  const now = new Date();
  const problems: HealthProblem[] = [];
  const guard = async (
    check: HealthProblem["check"],
    run: () => Promise<HealthProblem[]>,
  ) => {
    try {
      problems.push(...(await run()));
    } catch (error) {
      // An unreachable signal is itself unhealthy — never grade it "ok".
      problems.push({
        check,
        detail: `check failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  await guard("freshness", () => checkFreshness(now));
  const token = process.env.VERCEL_TOKEN?.trim();
  if (token) {
    await guard("cron-binding", () => checkCronBinding(token));
  } else {
    console.log("cron-binding: SKIPPED (VERCEL_TOKEN not set)");
  }

  for (const problem of problems) {
    console.error(`✗ [${problem.check}] ${problem.detail}`);
  }
  console.log(
    JSON.stringify({ checkedAt: now.toISOString(), ok: problems.length === 0, problems }),
  );
  if (problems.length > 0) {
    console.error(
      "Production unhealthy — runbook: docs/operations/production-monitoring.md",
    );
    process.exit(1);
  }
}

main();
