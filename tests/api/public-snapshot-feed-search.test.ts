import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { GET as getPublicFeed } from "@/app/api/public/feed/route";
import { GET as getPublicSearch } from "@/app/api/public/search/route";
import { GET as getOpenApi } from "@/app/openapi.yaml/route";
import { GET as getSkill } from "@/app/skill.md/route";
import { canonicalJsonBytes } from "@/lib/public-content/canonical";
import {
  snapshotPointerSchema,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import { CURRENT_POINTER_KEY, releaseManifestKey } from "@/lib/public-content/paths";
import { buildPublicRelease } from "@/lib/public-content/publisher/build-release";
import type { PublicEntityChange } from "@/lib/public-content/publisher/types";
import { MemoryPublicSnapshotHttp } from "@/lib/public-content/testing/memory-store";
import { __resetPublicBuckets } from "@/lib/rate-limit/public";
import { PUBLIC_SEMANTIC_SEARCH_ERROR } from "@/lib/search/query-defaults";
import { checkSourcePublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import {
  EXPECTED_QUERY_IDS,
  PARITY_STATE,
} from "../public-content/fixtures/parity-corpus";

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.R2_PUBLIC_BASE_URL;
let http: MemoryPublicSnapshotHttp;

beforeAll(async () => {
  http = await feedSearchFixture();
  const routedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.origin !== http.baseUrl) {
      throw new Error(`poison network/embedding path: ${url.origin}`);
    }
    return http.fetch(input, init);
  };
  globalThis.fetch = Object.assign(routedFetch, {
    preconnect: () => undefined,
  });
  process.env.R2_PUBLIC_BASE_URL = http.baseUrl;
});

beforeEach(() => {
  __resetPublicBuckets();
  process.env.R2_PUBLIC_BASE_URL = http.baseUrl;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalBaseUrl === undefined) delete process.env.R2_PUBLIC_BASE_URL;
  else process.env.R2_PUBLIC_BASE_URL = originalBaseUrl;
});

describe("snapshot-backed public feed and lexical search", () => {
  test("preserves tier, source, curation, tag, date and range filters", async () => {
    const cases: Array<[string, number[]]> = [
      ["tier=all&limit=100", EXPECTED_QUERY_IDS.all],
      ["tier=featured&limit=100", EXPECTED_QUERY_IDS.featured],
      ["tier=p1&limit=100", EXPECTED_QUERY_IDS.p1],
      [
        "tier=all&source_id=beta-x&source_group=podcast&source_kind=rss&limit=100",
        EXPECTED_QUERY_IDS.sourcePrecedence,
      ],
      ["tier=all&curated_only=true&limit=100", EXPECTED_QUERY_IDS.curated],
      [
        "tier=all&include_source_tags=preferred&limit=100",
        EXPECTED_QUERY_IDS.includePreferred,
      ],
      [
        "tier=all&exclude_source_tags=blocked&limit=100",
        EXPECTED_QUERY_IDS.excludeBlocked,
      ],
      ["tier=all&date=2026-07-13&limit=100", EXPECTED_QUERY_IDS.dateJuly13],
      [
        "tier=all&date_from=2026-07-13T21%3A00%3A00.000Z&date_to=2026-07-14T10%3A00%3A00.000Z&limit=100",
        EXPECTED_QUERY_IDS.range,
      ],
    ];
    for (const [query, expected] of cases) {
      const response = await getPublicFeed(request(`/api/public/feed?${query}`));
      expect(response.status).toBe(200);
      expect(ids(await response.json())).toEqual(expected);
    }
  });

  test("preserves localization, view, ordering, pagination totals and ETag", async () => {
    const english = await getPublicFeed(
      request("/api/public/feed?tier=featured&locale=en&limit=100"),
    );
    const englishBody = await english.json();
    expect(englishBody.items[0]).toMatchObject({
      id: "1",
      title: "Alpha event",
      publisher: "Alpha Podcast",
    });

    const chinese = await getPublicFeed(
      request("/api/public/feed?tier=featured&locale=zh&limit=100"),
    );
    expect((await chinese.json()).items[0]).toMatchObject({
      id: "1",
      title: "Alpha 事件",
      publisher: "阿尔法播客",
    });

    const page = await getPublicFeed(
      request("/api/public/feed?tier=all&offset=2&limit=3&view=archive"),
    );
    const pageBody = await page.json();
    expect(ids(pageBody)).toEqual([8, 10, 4]);
    expect(pageBody).toMatchObject({ total: 8, limit: 3, offset: 2, view: "archive" });
    expect(english.headers.get("access-control-allow-origin")).toBe("*");

    const etag = english.headers.get("etag");
    const notModified = await getPublicFeed(
      request("/api/public/feed?tier=featured&locale=en&limit=100", {
        "if-none-match": etag!,
      }),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");

    const today = await getPublicFeed(
      request("/api/public/feed?tier=all&view=today&limit=100"),
    );
    expect(today.status).toBe(200);
    expect((await today.json()).view).toBe("today");
  });

  test("preserves lexical wildcard, filters, localization and stable totals", async () => {
    const wildcard = await getPublicSearch(
      request("/api/public/search?q=a_00&tier=all&limit=50"),
    );
    const wildcardBody = await wildcard.json();
    expect(ids(wildcardBody)).toEqual(EXPECTED_QUERY_IDS.wildcard);
    expect(wildcardBody).toMatchObject({
      mode: "lexical",
      q: "a_00",
      total: 1,
      limit: 50,
      offset: 0,
    });

    const alphaZh = await getPublicSearch(
      request("/api/public/search?q=Alpha&tier=all&locale=zh&limit=1"),
    );
    const firstPage = await alphaZh.json();
    expect(firstPage.items[0]).toMatchObject({ id: "1", title: "Alpha 事件" });
    expect(firstPage.total).toBeGreaterThan(firstPage.items.length);

    const alphaEn = await getPublicSearch(
      request("/api/public/search?q=Alpha&tier=all&locale=en&offset=1&limit=1"),
    );
    const secondPage = await alphaEn.json();
    expect(secondPage).toMatchObject({
      mode: "lexical",
      q: "Alpha",
      total: firstPage.total,
      limit: 1,
      offset: 1,
    });

    const invalid = await getPublicSearch(request("/api/public/search?limit=2"));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toContain("invalid_query:");
  });

  test("rejects semantic mode before any snapshot, DB or embedding access", async () => {
    const readsBefore = http.requests.length;
    const response = await getPublicSearch(
      request("/api/public/search?q=agentic+coding&mode=semantic"),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: PUBLIC_SEMANTIC_SEARCH_ERROR,
    });
    expect(http.requests).toHaveLength(readsBefore);
  });

  test("feed/search source graphs contain no DB or semantic runtime", () => {
    const boundary = checkSourcePublicDbBoundary({
      rootDir: process.cwd(),
      entrypointSources: [
        "app/api/public/feed/route.ts",
        "app/api/public/search/route.ts",
      ],
    });
    expect(boundary.ok).toBeTrue();
    expect(boundary.violations).toHaveLength(0);
    expect(boundary.visitedFiles).not.toContain("lib/items/live.ts");
    expect(boundary.visitedFiles).not.toContain("lib/items/semantic-search.ts");
    expect(boundary.visitedFiles).not.toContain("lib/api/search-results.ts");
  });

  test("documents the anonymous semantic 422 and authenticated alternative", async () => {
    const [openapi, skill] = await Promise.all([
      getOpenApi().then((response) => response.text()),
      getSkill().then((response) => response.text()),
    ]);
    for (const document of [openapi, skill]) {
      expect(document).toContain(PUBLIC_SEMANTIC_SEARCH_ERROR);
      expect(document).toContain("422");
      expect(document).toContain("v1/MCP");
    }
    expect(openapi).not.toContain("embeds q via Azure");
    expect(skill).not.toContain("/search?q=...&mode=semantic");
  });
});

function request(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://newsroom.test${path}`, { headers });
}

function ids(body: { items: Array<{ id: string }> }): number[] {
  return body.items.map(({ id }) => Number(id));
}

async function feedSearchFixture(): Promise<MemoryPublicSnapshotHttp> {
  const release = await buildPublicRelease({
    previousManifest: null,
    sourceWatermark: 20,
    changes: allChanges(PARITY_STATE),
    generatedAtMs: Date.parse("2026-07-14T12:00:00.000Z"),
    loadArtifact: async () => {
      throw new Error("fixture cannot load a prior artifact");
    },
  });
  const store = new MemoryPublicSnapshotHttp(
    "https://feed-search-content.test",
  );
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
        publishedAt: "2026-07-14T12:00:00.000Z",
        sourceWatermark: 20,
      }),
    ),
  );
  return store;
}

function allChanges(state: CanonicalPublicState): PublicEntityChange[] {
  return [
    ...state.sources.map((value) => ({
      entityType: "source" as const,
      entityKey: value.id,
      value,
    })),
    ...state.items.map((value) => ({
      entityType: "item" as const,
      entityKey: String(value.id),
      value,
    })),
    ...state.events.map((value) => ({
      entityType: "event" as const,
      entityKey: String(value.id),
      value,
    })),
    ...state.newsletters.map((value) => ({
      entityType: "newsletter" as const,
      entityKey: String(value.id),
      value,
    })),
    ...state.policies.map((value) => ({
      entityType: "policy" as const,
      entityKey: value.skillName,
      value,
    })),
  ];
}
