import {
  ANONYMOUS_SERVING_ENTRYPOINTS,
  SNAPSHOT_ONLY_ENTRYPOINTS,
} from "@/lib/public-content/entrypoints";

export type PublicRuntimeCase = {
  readonly appPath: string;
  readonly expectedStatus: number;
  readonly kind: "page" | "route";
  readonly path: string;
};

export type AnonymousLoadRequest = {
  readonly expectedStatus: number;
  readonly method: "GET" | "HEAD" | "RSC";
  readonly path: string;
  readonly session: number;
};

export type AnonymousLoadScenario =
  "warm" | "cache-miss" | "cold-deploy" | "missing-object";

export type PublicRuntimeFixtures = {
  readonly dailyDate?: string;
  readonly eventId?: number;
  readonly itemId?: number;
  readonly podcastId?: number;
};

export const PUBLIC_RUNTIME_CASES: readonly PublicRuntimeCase[] = [
  {
    appPath: "/[locale]/agents/page",
    expectedStatus: 200,
    kind: "page",
    path: "/en/agents",
  },
  {
    appPath: "/[locale]/all/page",
    expectedStatus: 200,
    kind: "page",
    path: "/en/all?offset=1",
  },
  {
    appPath: "/[locale]/curated/page",
    expectedStatus: 200,
    kind: "page",
    path: "/en/curated",
  },
  {
    appPath: "/[locale]/daily/[date]/page",
    expectedStatus: 200,
    kind: "page",
    path: "/zh/daily/2026-07-14",
  },
  {
    appPath: "/[locale]/daily/page",
    expectedStatus: 200,
    kind: "page",
    path: "/zh/daily",
  },
  {
    appPath: "/[locale]/newsletter/page",
    expectedStatus: 200,
    kind: "page",
    path: "/zh/newsletter",
  },
  { appPath: "/[locale]/page", expectedStatus: 200, kind: "page", path: "/en" },
  {
    appPath: "/[locale]/podcasts/[id]/page",
    expectedStatus: 200,
    kind: "page",
    path: "/en/podcasts/1",
  },
  {
    appPath: "/[locale]/podcasts/page",
    expectedStatus: 200,
    kind: "page",
    path: "/en/podcasts?source=alpha-podcast",
  },
  {
    appPath: "/[locale]/sources/page",
    expectedStatus: 200,
    kind: "page",
    path: "/en/sources",
  },
  {
    appPath: "/[locale]/x-monitor/page",
    expectedStatus: 200,
    kind: "page",
    path: "/en/x-monitor?handle=beta-x",
  },
  {
    appPath: "/api/events/[id]/members/route",
    expectedStatus: 200,
    kind: "route",
    path: "/api/events/100/members?locale=en",
  },
  {
    appPath: "/api/feed/[locale]/rss.xml/route",
    expectedStatus: 200,
    kind: "route",
    path: "/api/feed/en/rss.xml",
  },
  {
    appPath: "/api/feed/newsletter/[locale]/rss.xml/route",
    expectedStatus: 200,
    kind: "route",
    path: "/api/feed/newsletter/en/rss.xml",
  },
  {
    appPath: "/api/public/dailies/route",
    expectedStatus: 200,
    kind: "route",
    path: "/api/public/dailies?locale=zh&take=10",
  },
  {
    appPath: "/api/public/daily/[date]/route",
    expectedStatus: 200,
    kind: "route",
    path: "/api/public/daily/2026-07-14?locale=zh",
  },
  {
    appPath: "/api/public/daily/route",
    expectedStatus: 200,
    kind: "route",
    path: "/api/public/daily?locale=zh",
  },
  {
    appPath: "/api/public/events/[id]/members/route",
    expectedStatus: 200,
    kind: "route",
    path: "/api/public/events/100/members?locale=en",
  },
  {
    appPath: "/api/public/feed/route",
    expectedStatus: 200,
    kind: "route",
    path: "/api/public/feed?locale=en&limit=10",
  },
  {
    appPath: "/api/public/items/[id]/route",
    expectedStatus: 200,
    kind: "route",
    path: "/api/public/items/1?locale=en",
  },
  {
    appPath: "/api/public/search/route",
    expectedStatus: 200,
    kind: "route",
    path: "/api/public/search?q=Alpha&locale=en",
  },
  {
    appPath: "/api/public/sources/route",
    expectedStatus: 200,
    kind: "route",
    path: "/api/public/sources?locale=en",
  },
  {
    appPath: "/api/rss/[slug]/route",
    expectedStatus: 200,
    kind: "route",
    path: "/api/rss/today.xml",
  },
  {
    appPath: "/api/sources/active/route",
    expectedStatus: 200,
    kind: "route",
    path: "/api/sources/active",
  },
  {
    appPath: "/[locale]/login/page",
    expectedStatus: 200,
    kind: "page",
    path: "/en/login",
  },
  {
    appPath: "/_global-error/page",
    expectedStatus: 404,
    kind: "page",
    path: "/en/__global-error-fallback-probe",
  },
  {
    appPath: "/_not-found/page",
    expectedStatus: 404,
    kind: "page",
    path: "/en/__not-found-probe",
  },
  {
    appPath: "/openapi.yaml/route",
    expectedStatus: 200,
    kind: "route",
    path: "/openapi.yaml",
  },
  {
    appPath: "/robots.txt/route",
    expectedStatus: 200,
    kind: "route",
    path: "/robots.txt",
  },
  {
    appPath: "/sitemap.xml/route",
    expectedStatus: 200,
    kind: "route",
    path: "/sitemap.xml",
  },
  {
    appPath: "/skill.md/route",
    expectedStatus: 200,
    kind: "route",
    path: "/skill.md",
  },
] as const;

export function assertPublicRuntimeCorpusComplete(): void {
  const actual = PUBLIC_RUNTIME_CASES.map(({ appPath }) => appPath).sort();
  const expected = ANONYMOUS_SERVING_ENTRYPOINTS.map(
    ({ appPath }) => appPath,
  ).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("public runtime corpus does not match anonymous inventory");
  }
}

export function buildAnonymousLoadPlan(
  multiplier: 1 | 10 | 100,
  scenario: AnonymousLoadScenario = "warm",
  fixtures: PublicRuntimeFixtures = {},
): AnonymousLoadRequest[] {
  if (![1, 10, 100].includes(multiplier)) {
    throw new Error("load multiplier must be 1, 10 or 100");
  }
  assertRuntimeFixtures(fixtures);
  assertPublicRuntimeCorpusComplete();
  const snapshotAppPaths = new Set(
    SNAPSHOT_ONLY_ENTRYPOINTS.map(({ appPath }) => appPath),
  );
  const requests: AnonymousLoadRequest[] = [];
  for (let session = 1; session <= multiplier; session += 1) {
    for (const runtimeCase of PUBLIC_RUNTIME_CASES) {
      const runtimePath = pathForRuntimeFixtures(runtimeCase, fixtures);
      const expectedStatus =
        scenario === "missing-object" &&
        snapshotAppPaths.has(runtimeCase.appPath) &&
        runtimeCase.expectedStatus === 200
          ? 503
          : runtimeCase.expectedStatus;
      requests.push({
        expectedStatus,
        method: "GET",
        path: runtimePath,
        session,
      });
      requests.push({
        expectedStatus,
        method: "HEAD",
        path: runtimePath,
        session,
      });
      if (
        runtimeCase.kind === "page" &&
        runtimeCase.expectedStatus === 200 &&
        scenario !== "missing-object"
      ) {
        const url = new URL(runtimePath, "https://runtime.invalid");
        url.searchParams.set("_rsc", `load-${session}`);
        requests.push({
          expectedStatus: 200,
          method: "RSC",
          path: `${url.pathname}${url.search}`,
          session,
        });
      }
    }
  }
  return requests;
}

function pathForRuntimeFixtures(
  runtimeCase: PublicRuntimeCase,
  fixtures: PublicRuntimeFixtures,
): string {
  switch (runtimeCase.appPath) {
    case "/[locale]/daily/[date]/page":
      return fixtures.dailyDate
        ? `/zh/daily/${fixtures.dailyDate}`
        : runtimeCase.path;
    case "/api/public/daily/[date]/route":
      return fixtures.dailyDate
        ? `/api/public/daily/${fixtures.dailyDate}?locale=zh`
        : runtimeCase.path;
    case "/api/events/[id]/members/route":
      return fixtures.eventId
        ? `/api/events/${fixtures.eventId}/members?locale=en`
        : runtimeCase.path;
    case "/api/public/events/[id]/members/route":
      return fixtures.eventId
        ? `/api/public/events/${fixtures.eventId}/members?locale=en`
        : runtimeCase.path;
    case "/api/public/items/[id]/route":
      return fixtures.itemId
        ? `/api/public/items/${fixtures.itemId}?locale=en`
        : runtimeCase.path;
    case "/[locale]/podcasts/[id]/page":
      return fixtures.podcastId
        ? `/en/podcasts/${fixtures.podcastId}`
        : runtimeCase.path;
    default:
      return runtimeCase.path;
  }
}

function assertRuntimeFixtures(fixtures: PublicRuntimeFixtures): void {
  for (const [name, value] of Object.entries(fixtures)) {
    if (name === "dailyDate") continue;
    if (!Number.isSafeInteger(value) || Number(value) <= 0) {
      throw new Error(`${name} must be a positive safe integer`);
    }
  }
  if (
    fixtures.dailyDate !== undefined &&
    !/^\d{4}-\d{2}-\d{2}$/.test(fixtures.dailyDate)
  ) {
    throw new Error("dailyDate must be YYYY-MM-DD");
  }
}
