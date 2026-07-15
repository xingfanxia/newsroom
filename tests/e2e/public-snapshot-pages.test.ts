import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { canonicalJsonBytes } from "@/lib/public-content/canonical";
import {
  snapshotPointerSchema,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import {
  listPublicDailyColumns,
} from "@/lib/public-content/public-dailies";
import {
  publicPageItemDetail,
  publicPolicySummary,
} from "@/lib/public-content/page-data";
import { CURRENT_POINTER_KEY, releaseManifestKey } from "@/lib/public-content/paths";
import { buildPublicRelease } from "@/lib/public-content/publisher/build-release";
import type { PublicEntityChange } from "@/lib/public-content/publisher/types";
import { PublicSnapshotUnavailableError } from "@/lib/public-content/reader";
import { MemoryPublicSnapshotHttp } from "@/lib/public-content/testing/memory-store";
import { shellChromeDataFromSnapshot } from "@/lib/shell/chrome-data";
import { checkSourcePublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import { readSource } from "@/tests/helpers/source";
import {
  PARITY_NOW_ISO,
  PARITY_NOW_MS,
  PARITY_STATE,
} from "../public-content/fixtures/parity-corpus";

mock.module("next-intl/server", () => ({
  setRequestLocale: () => undefined,
}));

const PAGE_SOURCES = [
  "app/[locale]/page.tsx",
  "app/[locale]/all/page.tsx",
  "app/[locale]/curated/page.tsx",
  "app/[locale]/sources/page.tsx",
  "app/[locale]/podcasts/page.tsx",
  "app/[locale]/podcasts/[id]/page.tsx",
  "app/[locale]/x-monitor/page.tsx",
  "app/[locale]/daily/page.tsx",
  "app/[locale]/daily/[date]/page.tsx",
  "app/[locale]/agents/page.tsx",
] as const;

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.R2_PUBLIC_BASE_URL;
const stores = new Map<string, MemoryPublicSnapshotHttp>();
let http: MemoryPublicSnapshotHttp;

beforeAll(async () => {
  http = await pageFixture();
  stores.set(http.baseUrl, http);
  const routedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const store = stores.get(url.origin);
    if (!store) throw new Error(`poison network path: ${url.origin}`);
    return store.fetch(input, init);
  };
  globalThis.fetch = Object.assign(routedFetch, { preconnect: () => undefined });
  process.env.R2_PUBLIC_BASE_URL = http.baseUrl;
});

beforeEach(() => {
  process.env.R2_PUBLIC_BASE_URL = http.baseUrl;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalBaseUrl === undefined) delete process.env.R2_PUBLIC_BASE_URL;
  else process.env.R2_PUBLIC_BASE_URL = originalBaseUrl;
});

describe("snapshot-backed anonymous pages", () => {
  test("builds every HTML/RSC page variant without a DB or external network", async () => {
    const [
      { default: HotNewsPage },
      { default: AllPostsPage },
      { default: CuratedPage },
      { default: SourcesPage },
      { default: PodcastsPage },
      { default: PodcastDetailPage },
      { default: XMonitorPage },
      { default: DailyLandingPage },
      { default: DailyDatePage },
      { default: AgentsPage },
    ] = await Promise.all([
      import("@/app/[locale]/page"),
      import("@/app/[locale]/all/page"),
      import("@/app/[locale]/curated/page"),
      import("@/app/[locale]/sources/page"),
      import("@/app/[locale]/podcasts/page"),
      import("@/app/[locale]/podcasts/[id]/page"),
      import("@/app/[locale]/x-monitor/page"),
      import("@/app/[locale]/daily/page"),
      import("@/app/[locale]/daily/[date]/page"),
      import("@/app/[locale]/agents/page"),
    ]);
    const pages = await Promise.all([
      HotNewsPage({ params: locale("zh"), searchParams: Promise.resolve({ view: "daily" }) }),
      AllPostsPage({ params: locale("en"), searchParams: Promise.resolve({ offset: "1" }) }),
      CuratedPage({ params: locale("zh"), searchParams: Promise.resolve({}) }),
      SourcesPage({ params: locale("en"), searchParams: Promise.resolve({ view: "table" }) }),
      PodcastsPage({ params: locale("zh"), searchParams: Promise.resolve({ source: "alpha-podcast" }) }),
      PodcastDetailPage({ params: Promise.resolve({ locale: "en", id: "1" }) }),
      XMonitorPage({ params: locale("zh"), searchParams: Promise.resolve({ handle: "beta-x" }) }),
      DailyLandingPage({ params: locale("zh"), searchParams: Promise.resolve({ p: "1" }) }),
      DailyDatePage({ params: Promise.resolve({ locale: "zh", date: "2026-07-14" }) }),
      AgentsPage({ params: locale("en") }),
    ]);
    expect(pages).toHaveLength(PAGE_SOURCES.length);
    for (const page of pages) expect(page).toBeTruthy();
  });

  test("derives chrome, policy, detail and paged dailies without private reasoning", () => {
    const chrome = shellChromeDataFromSnapshot(PARITY_STATE, PARITY_NOW_MS, {
      pulse: true,
      signalRatio: "fromRadar",
    });
    expect(chrome.radarStats.tracked_sources).toBe(3);
    expect(chrome.pulse).toHaveLength(24);
    expect(publicPolicySummary(PARITY_STATE, PARITY_NOW_MS)).toEqual({
      version: "v18",
      lastIterAt: "just now",
    });

    const detail = publicPageItemDetail(PARITY_STATE, 1, "zh", PARITY_NOW_MS);
    expect(detail?.bodyMd).toBe("Alpha public body");
    expect(detail?.story.whyFeatured).toContain("精选");
    expect(detail?.story).not.toHaveProperty("reasoning");
    expect(JSON.stringify(detail)).not.toContain("reasonsZh");

    expect(
      listPublicDailyColumns(PARITY_STATE, { locale: "zh", take: 1, offset: 1 })
        .map(({ date }) => date),
    ).toEqual(["2026-07-13"]);
  });

  test("fails closed when no active, previous or warm snapshot exists", async () => {
    const unavailable = new MemoryPublicSnapshotHttp("https://page-unavailable.test");
    stores.set(unavailable.baseUrl, unavailable);
    process.env.R2_PUBLIC_BASE_URL = unavailable.baseUrl;

    const { default: AgentsPage } = await import("@/app/[locale]/agents/page");
    await expect(AgentsPage({ params: locale("zh") })).rejects.toBeInstanceOf(
      PublicSnapshotUnavailableError,
    );
  });

  test("all page graphs are recursively DB-free and SourcePicker uses the public alias", () => {
    const boundary = checkSourcePublicDbBoundary({
      rootDir: process.cwd(),
      entrypointSources: PAGE_SOURCES,
    });
    expect(boundary.ok).toBeTrue();
    expect(boundary.violations).toHaveLength(0);
    const picker = readSource("components/shell/source-picker.tsx");
    expect(picker).toContain('fetch("/api/sources/active"');
    expect(picker).toContain('credentials: "omit"');
  });

  test("renders a controlled locale fallback without exposing server errors", () => {
    const boundary = readSource("app/[locale]/error.tsx");
    expect(boundary).toContain('"use client"');
    expect(boundary).toContain("unstable_retry");
    expect(boundary).toContain("内容暂时不可用");
    expect(boundary).not.toContain("error.message");
  });
});

function locale(value: string): Promise<{ locale: string }> {
  return Promise.resolve({ locale: value });
}

async function pageFixture(): Promise<MemoryPublicSnapshotHttp> {
  const release = await buildPublicRelease({
    previousManifest: null,
    sourceWatermark: 40,
    changes: allChanges(PARITY_STATE),
    loadArtifact: async () => {
      throw new Error("fixture cannot load a prior artifact");
    },
  });
  const store = new MemoryPublicSnapshotHttp("https://page-content.test");
  for (const artifact of release.artifacts) {
    store.put(artifact.descriptor.key, artifact.bytes);
  }
  const manifestKey = releaseManifestKey(release.releaseId);
  store.put(manifestKey, release.manifestBytes);
  store.put(
    CURRENT_POINTER_KEY,
    canonicalJsonBytes(
      snapshotPointerSchema.parse({
        schemaVersion: 1,
        active: {
          releaseId: release.releaseId,
          manifestKey,
          manifestSha256: release.manifestSha256,
        },
        previous: null,
        publishedAt: PARITY_NOW_ISO,
        sourceWatermark: 40,
      }),
    ),
  );
  return store;
}

function allChanges(state: CanonicalPublicState): PublicEntityChange[] {
  return [
    ...state.sources.map((value) => ({ entityType: "source" as const, entityKey: value.id, value })),
    ...state.items.map((value) => ({ entityType: "item" as const, entityKey: String(value.id), value })),
    ...state.events.map((value) => ({ entityType: "event" as const, entityKey: String(value.id), value })),
    ...state.newsletters.map((value) => ({ entityType: "newsletter" as const, entityKey: String(value.id), value })),
    ...state.policies.map((value) => ({ entityType: "policy" as const, entityKey: value.skillName, value })),
  ];
}
