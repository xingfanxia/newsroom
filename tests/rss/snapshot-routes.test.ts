import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { GET as getMainRss } from "@/app/api/feed/[locale]/rss.xml/route";
import { GET as getNewsletterRss } from "@/app/api/feed/newsletter/[locale]/rss.xml/route";
import { GET as getLegacyRss } from "@/app/api/rss/[slug]/route";
import { canonicalJsonBytes } from "@/lib/public-content/canonical";
import {
  snapshotPointerSchema,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import {
  ANONYMOUS_SERVING_ENTRYPOINTS,
} from "@/lib/public-content/entrypoints";
import { CURRENT_POINTER_KEY, releaseManifestKey } from "@/lib/public-content/paths";
import { buildPublicRelease } from "@/lib/public-content/publisher/build-release";
import type { PublicEntityChange } from "@/lib/public-content/publisher/types";
import { __resetPublicRssArtifacts } from "@/lib/public-content/rss-http";
import { MemoryPublicSnapshotHttp } from "@/lib/public-content/testing/memory-store";
import { RSS_CONTENT_TYPE, rssCacheControl } from "@/lib/rss/http-contract";
import { checkSourcePublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import {
  EXPECTED_RSS_SHA256,
  PARITY_NOW_ISO,
  PARITY_STATE,
} from "../public-content/fixtures/parity-corpus";

const ROUTE_SOURCES = [
  "app/api/feed/[locale]/rss.xml/route.ts",
  "app/api/feed/newsletter/[locale]/rss.xml/route.ts",
  "app/api/rss/[slug]/route.ts",
] as const;

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.R2_PUBLIC_BASE_URL;
const stores = new Map<string, MemoryPublicSnapshotHttp>();
let http: MemoryPublicSnapshotHttp;

beforeAll(async () => {
  http = await rssFixture();
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
  __resetPublicRssArtifacts();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalBaseUrl === undefined) delete process.env.R2_PUBLIC_BASE_URL;
  else process.env.R2_PUBLIC_BASE_URL = originalBaseUrl;
});

describe("snapshot-backed RSS routes", () => {
  test("serves hash-frozen main RSS bytes and preserves locale fallback", async () => {
    const zh = await main("zh");
    const en = await main("en");
    const fallback = await main("fr");

    expect(sha256(await zh.text())).toBe(EXPECTED_RSS_SHA256.mainZh);
    expect(sha256(await en.text())).toBe(EXPECTED_RSS_SHA256.mainEn);
    expect(sha256(await fallback.text())).toBe(EXPECTED_RSS_SHA256.mainZh);
    expectRssHeaders(zh);
    expectRssHeaders(en);
  });

  test("serves both structured-newsletter locales from the release", async () => {
    const en = await newsletter("en");
    const zh = await newsletter("zh");
    const fallback = await newsletter("unknown");

    expect(sha256(await en.text())).toBe(EXPECTED_RSS_SHA256.newsletterEn);
    const zhXml = await zh.text();
    expect(zhXml).toContain("AX 的 AI 雷达 · 每日/每月 速递");
    expect(zhXml).toContain("[月报]");
    expect(await fallback.text()).toBe(zhXml);
    expectRssHeaders(en);
    expectRssHeaders(zh);
  });

  test("serves every legacy variant and preserves invalid-slug behavior", async () => {
    const cases = [
      ["today.xml", EXPECTED_RSS_SHA256.legacyToday],
      ["curated.xml", EXPECTED_RSS_SHA256.legacyCurated],
      ["daily.xml", EXPECTED_RSS_SHA256.legacyDaily],
    ] as const;
    for (const [slug, expected] of cases) {
      const response = await legacy(slug, `rss-${slug}`);
      expect(response.status).toBe(200);
      expect(sha256(await response.text())).toBe(expected);
      expectRssHeaders(response);
    }

    const invalid = await legacy("papers.xml", "rss-invalid");
    expect(invalid.status).toBe(404);
    expect(await invalid.text()).toBe("not found");
  });

  test("maps a cold snapshot failure to a controlled non-cacheable 503", async () => {
    const unavailable = new MemoryPublicSnapshotHttp("https://rss-unavailable.test");
    stores.set(unavailable.baseUrl, unavailable);
    process.env.R2_PUBLIC_BASE_URL = unavailable.baseUrl;

    for (const response of [
      await main("zh"),
      await newsletter("en"),
      await legacy("today.xml", "rss-unavailable"),
    ]) {
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("retry-after")).toBe("60");
      expect(await response.text()).toBe("snapshot unavailable");
    }
  });

  test("keeps GET-to-HEAD inventory coverage and removes recursive DB ownership", () => {
    for (const sourcePath of ROUTE_SOURCES) {
      const entrypoint = ANONYMOUS_SERVING_ENTRYPOINTS.find(
        (candidate) => candidate.sourcePath === sourcePath,
      );
      expect(entrypoint?.methods).toEqual(["GET", "HEAD"]);
    }

    const boundary = checkSourcePublicDbBoundary({
      rootDir: process.cwd(),
      entrypointSources: ROUTE_SOURCES,
    });
    expect(boundary.ok).toBeTrue();
    expect(boundary.violations).toHaveLength(0);
    expect(boundary.visitedFiles).not.toContain("lib/rss/main-feed.ts");
    expect(boundary.visitedFiles).not.toContain("lib/rss/newsletter-feed.ts");
    expect(boundary.visitedFiles).not.toContain("lib/rss/legacy-feeds.ts");
  });
});

async function main(locale: string): Promise<Response> {
  return getMainRss(new Request(`https://newsroom.test/api/feed/${locale}/rss.xml`), {
    params: Promise.resolve({ locale }),
  });
}

async function newsletter(locale: string): Promise<Response> {
  return getNewsletterRss(
    new Request(`https://newsroom.test/api/feed/newsletter/${locale}/rss.xml`),
    { params: Promise.resolve({ locale }) },
  );
}

async function legacy(slug: string, ip: string): Promise<Response> {
  return getLegacyRss(
    new Request(`https://newsroom.test/api/rss/${slug}`, {
      headers: { "x-forwarded-for": ip },
    }),
    { params: Promise.resolve({ slug }) },
  );
}

function expectRssHeaders(response: Response): void {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(RSS_CONTENT_TYPE);
  expect(response.headers.get("cache-control")).toBe(rssCacheControl());
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function rssFixture(): Promise<MemoryPublicSnapshotHttp> {
  const release = await buildPublicRelease({
    previousManifest: null,
    sourceWatermark: 30,
    changes: allChanges(PARITY_STATE),
    loadArtifact: async () => {
      throw new Error("fixture cannot load a prior artifact");
    },
  });
  const store = new MemoryPublicSnapshotHttp("https://rss-content.test");
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
        sourceWatermark: 30,
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
