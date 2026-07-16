import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { GET as getEventMembers } from "@/app/api/events/[id]/members/route";
import { GET as getPublicDailyByDate } from "@/app/api/public/daily/[date]/route";
import { GET as getPublicDaily } from "@/app/api/public/daily/route";
import { GET as getPublicDailies } from "@/app/api/public/dailies/route";
import { GET as getPublicEventMembers } from "@/app/api/public/events/[id]/members/route";
import { GET as getPublicItem } from "@/app/api/public/items/[id]/route";
import { GET as getPublicSources } from "@/app/api/public/sources/route";
import { GET as getActiveSources } from "@/app/api/sources/active/route";
import { canonicalJsonBytes } from "@/lib/public-content/canonical";
import {
  snapshotPointerSchema,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import { publicItemSnapshotResult } from "@/lib/public-content/http";
import { CURRENT_POINTER_KEY, releaseManifestKey } from "@/lib/public-content/paths";
import { buildPublicRelease } from "@/lib/public-content/publisher/build-release";
import type { PublicEntityChange } from "@/lib/public-content/publisher/types";
import { MemoryPublicSnapshotHttp } from "@/lib/public-content/testing/memory-store";
import { __resetPublicBuckets } from "@/lib/rate-limit/public";
import { checkSourcePublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import { canonicalState } from "../public-content/contract-fixtures";

const ROUTE_SOURCES = [
  "app/api/public/sources/route.ts",
  "app/api/public/items/[id]/route.ts",
  "app/api/public/events/[id]/members/route.ts",
  "app/api/public/daily/route.ts",
  "app/api/public/daily/[date]/route.ts",
  "app/api/public/dailies/route.ts",
  "app/api/events/[id]/members/route.ts",
  "app/api/sources/active/route.ts",
] as const;

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.R2_PUBLIC_BASE_URL;
const stores = new Map<string, MemoryPublicSnapshotHttp>();
let fixture: Awaited<ReturnType<typeof routeFixture>>;

beforeAll(async () => {
  fixture = await routeFixture();
  stores.set(fixture.http.baseUrl, fixture.http);
  const routedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const store = stores.get(url.origin);
    if (!store) throw new Error(`poison network path: ${url.origin}`);
    return store.fetch(input, init);
  };
  globalThis.fetch = Object.assign(routedFetch, {
    preconnect: () => undefined,
  });
  process.env.R2_PUBLIC_BASE_URL = fixture.http.baseUrl;
});

beforeEach(() => {
  __resetPublicBuckets();
  process.env.R2_PUBLIC_BASE_URL = fixture.http.baseUrl;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalBaseUrl === undefined) delete process.env.R2_PUBLIC_BASE_URL;
  else process.env.R2_PUBLIC_BASE_URL = originalBaseUrl;
});

describe("snapshot-backed public JSON routes", () => {
  test("serves the public source catalog with CORS, ETag and 304", async () => {
    const request = publicRequest("/api/public/sources");
    const response = await getPublicSources(request);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("s-maxage=");
    expect(body).toMatchObject({
      total: 1,
      sources: [
        {
          id: "openai-news",
          name_en: "OpenAI Blog",
          enabled: true,
          health: { total_items_count: 42 },
        },
      ],
    });

    const etag = response.headers.get("etag");
    expect(etag).not.toBeNull();
    const notModified = await getPublicSources(
      publicRequest("/api/public/sources", { "if-none-match": etag! }),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
  });

  test("serves only persisted eligible item details and preserves errors", async () => {
    const response = await getPublicItem(publicRequest("/api/public/items/1"), {
      params: Promise.resolve({ id: "1" }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: "1",
      source: { id: "openai-news", name_en: "OpenAI Blog" },
      title: { raw: "Raw title", zh: "标题", en: "Title" },
      hkr: { h: true, k: true, r: false },
      event: { cluster_id: 7, coverage: 2 },
      body_md: "Public, sanitized article markdown",
    });
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("body_rss");

    const emptyBody = await getPublicItem(
      publicRequest("/api/public/items/2"),
      { params: Promise.resolve({ id: "2" }) },
    );
    expect(emptyBody.status).toBe(200);
    expect((await emptyBody.json()).body_md).toBeNull();

    for (const id of ["777", "999999"]) {
      const missing = await getPublicItem(
        publicRequest(`/api/public/items/${id}`),
        { params: Promise.resolve({ id }) },
      );
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "not_found" });
    }
    const invalid = await getPublicItem(publicRequest("/api/public/items/0"), {
      params: Promise.resolve({ id: "0" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_id" });
  });

  test("preserves inline legacy bodies and the existing item ETag signal", async () => {
    const pointer = snapshotPointerSchema.parse({
      schemaVersion: 1,
      active: {
        releaseId: fixture.release.releaseId,
        manifestKey: releaseManifestKey(fixture.release.releaseId),
        manifestSha256: fixture.release.manifestSha256,
      },
      previous: null,
      publishedAt: "2026-07-14T12:00:00.000Z",
      sourceWatermark: fixture.release.manifest.sourceWatermark,
    });
    const release = {
      ref: pointer.active,
      manifest: fixture.release.manifest,
      pointer,
      source: "active" as const,
    };
    const inlineState: CanonicalPublicState = canonicalState();
    inlineState.sources[0] = { ...inlineState.sources[0]!, enabled: true };
    inlineState.items[1] = { ...inlineState.items[1]!, bodyMd: null };
    const splitState = {
      ...inlineState,
      items: inlineState.items.map((item) => ({ ...item, bodyMd: null })),
    };
    let bodyReads = 0;
    const reader = {
      readItemBody: async (pinnedRelease: typeof release, id: number) => {
        expect(pinnedRelease).toBe(release);
        bodyReads += 1;
        return id === 1 ? inlineState.items[0]!.bodyMd : null;
      },
    };

    const inline = await publicItemSnapshotResult(
      { state: inlineState, release },
      "1",
      reader,
    );
    const split = await publicItemSnapshotResult(
      { state: splitState, release },
      "1",
      reader,
    );
    const empty = await publicItemSnapshotResult(
      { state: splitState, release },
      "2",
      reader,
    );

    expect(inline).toMatchObject({
      ok: true,
      body: { body_md: "Public, sanitized article markdown" },
    });
    expect(split).toMatchObject({
      ok: true,
      body: { body_md: "Public, sanitized article markdown" },
    });
    expect(empty).toMatchObject({ ok: true, body: { body_md: null } });
    expect(bodyReads).toBe(2);
    expect(inline.ok).toBeTrue();
    expect(split.ok).toBeTrue();
    if (!inline.ok || !split.ok) throw new Error("expected item results");
    expect(inline.signal).toBe(split.signal);
  });

  test("preserves public and UI event-member locale/envelope contracts", async () => {
    const publicResponse = await getPublicEventMembers(
      publicRequest("/api/public/events/7/members"),
      { params: Promise.resolve({ id: "7" }) },
    );
    const publicBody = await publicResponse.json();
    expect(publicBody.cluster_id).toBe(7);
    expect(publicBody.total).toBe(2);
    expect(publicBody.members[0]).toMatchObject({
      source_name: "OpenAI Blog",
      title: "Title",
    });

    const uiResponse = await getEventMembers(
      publicRequest("/api/events/7/members"),
      { params: Promise.resolve({ id: "7" }) },
    );
    const uiBody = await uiResponse.json();
    expect(uiBody.total).toBe(2);
    expect(uiBody.members[0]).toMatchObject({
      source_name: "OpenAI 博客",
      title: "标题",
    });
    expect(uiBody).not.toHaveProperty("cluster_id");

    const unknown = await getPublicEventMembers(
      publicRequest("/api/public/events/999/members?locale=zh"),
      { params: Promise.resolve({ id: "999" }) },
    );
    expect(await unknown.json()).toEqual({ cluster_id: 999, members: [], total: 0 });
    const invalid = await getPublicEventMembers(
      publicRequest("/api/public/events/7/members?locale=ja"),
      { params: Promise.resolve({ id: "7" }) },
    );
    expect(invalid.status).toBe(400);
  });

  test("serves latest, dated and indexed daily columns with validation", async () => {
    const latest = await getPublicDaily(publicRequest("/api/public/daily"));
    expect(await latest.json()).toMatchObject({
      id: 4,
      date: "2026-07-14",
      title: "今日 AI",
      story_count: 2,
    });

    const dated = await getPublicDailyByDate(
      publicRequest("/api/public/daily/2026-07-14"),
      { params: Promise.resolve({ date: "2026-07-14" }) },
    );
    expect(dated.status).toBe(200);
    expect((await dated.json()).date).toBe("2026-07-14");

    const missing = await getPublicDailyByDate(
      publicRequest("/api/public/daily/2026-07-13"),
      { params: Promise.resolve({ date: "2026-07-13" }) },
    );
    expect(missing.status).toBe(404);
    const invalid = await getPublicDailyByDate(
      publicRequest("/api/public/daily/2026-02-30"),
      { params: Promise.resolve({ date: "2026-02-30" }) },
    );
    expect(invalid.status).toBe(400);

    const index = await getPublicDailies(
      publicRequest("/api/public/dailies?take=1&locale=zh"),
    );
    expect(await index.json()).toEqual({
      count: 1,
      items: [
        {
          id: 4,
          date: "2026-07-14",
          generated_at: "2026-07-14T12:00:00.000Z",
          title: "今日 AI",
          theme_tag: "模型进展",
          story_count: 2,
        },
      ],
    });
    const invalidIndex = await getPublicDailies(
      publicRequest("/api/public/dailies?take=0"),
    );
    expect(invalidIndex.status).toBe(400);
  });

  test("serves the active source picker from the same snapshot", async () => {
    const response = await getActiveSources();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sources: [
        {
          id: "openai-news",
          name_en: "OpenAI Blog",
          name_zh: "OpenAI 博客",
          kind: "rss",
          group: "vendor-official",
          locale: "en",
        },
      ],
      total: 1,
    });
  });

  test("maps cold reader failure to controlled 503 on public and UI routes", async () => {
    const unavailable = new MemoryPublicSnapshotHttp(
      "https://unavailable-content.test",
    );
    stores.set(unavailable.baseUrl, unavailable);
    process.env.R2_PUBLIC_BASE_URL = unavailable.baseUrl;

    const publicResponse = await getPublicSources(
      publicRequest("/api/public/sources"),
    );
    expect(publicResponse.status).toBe(503);
    expect(await publicResponse.json()).toEqual({ error: "snapshot_unavailable" });
    expect(publicResponse.headers.get("access-control-allow-origin")).toBe("*");

    const uiResponse = await getActiveSources();
    expect(uiResponse.status).toBe(503);
    expect(await uiResponse.json()).toEqual({ error: "snapshot_unavailable" });
  });

  test("all migrated route graphs are recursively free of DB dependencies", () => {
    const boundary = checkSourcePublicDbBoundary({
      rootDir: process.cwd(),
      entrypointSources: ROUTE_SOURCES,
    });
    expect(boundary.ok).toBeTrue();
    expect(boundary.violations).toHaveLength(0);
  });
});

function publicRequest(
  path: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://newsroom.test${path}`, { headers });
}

async function routeFixture() {
  const state: CanonicalPublicState = canonicalState();
  state.sources[0] = { ...state.sources[0]!, enabled: true };
  state.items[1] = { ...state.items[1]!, bodyMd: null };
  const release = await buildPublicRelease({
    previousManifest: null,
    sourceWatermark: 10,
    changes: allChanges(state),
    loadArtifact: async () => {
      throw new Error("fixture cannot load a prior artifact");
    },
  });
  const http = new MemoryPublicSnapshotHttp();
  for (const artifact of release.artifacts) {
    http.put(artifact.descriptor.key, artifact.bytes);
  }
  const manifestKey = releaseManifestKey(release.releaseId);
  http.put(manifestKey, release.manifestBytes);
  http.put(
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
        sourceWatermark: 10,
      }),
    ),
  );
  return { http, release, state };
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
