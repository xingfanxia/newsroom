import { describe, expect, test } from "bun:test";
import { GET as getOpenApiYaml } from "@/app/openapi.yaml/route";
import { GET as getSkillMarkdown } from "@/app/skill.md/route";
import {
  PUBLIC_CACHE_DEFAULT,
  PUBLIC_ENDPOINT_COUNT,
  PUBLIC_ENDPOINTS,
  PUBLIC_RATE_LIMIT_DOC_GROUPS,
  PUBLIC_RATE_LIMIT_DEFAULT,
  PUBLIC_RATE_LIMIT_WINDOW_MS,
  publicCacheConfig,
  publicCacheHeaderLabel,
  publicRateLimitConfig,
  publicRateLimitLabel,
  publicRateLimitPerIpLabel,
  publicRateLimitReqLabel,
} from "@/lib/api/public-endpoint-config";
import { readSource as readProjectFile } from "@/tests/helpers/source";

const routeContracts = [
  ["feed", "app/api/public/feed/route.ts"],
  ["item", "app/api/public/items/[id]/route.ts"],
  ["eventMembers", "app/api/public/events/[id]/members/route.ts"],
  ["search", "app/api/public/search/route.ts"],
  ["sources", "app/api/public/sources/route.ts"],
  ["daily", "app/api/public/daily/route.ts"],
  ["dailyByDate", "app/api/public/daily/[date]/route.ts"],
  ["dailies", "app/api/public/dailies/route.ts"],
] as const;

describe("public API endpoint contract", () => {
  test("public endpoint limits have one runtime source of truth", () => {
    expect(PUBLIC_RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(PUBLIC_ENDPOINT_COUNT).toBe(8);
    expect(PUBLIC_ENDPOINTS.feed.rateLimit.max).toBe(600);
    expect(PUBLIC_ENDPOINTS.item.rateLimit.max).toBe(600);
    expect(PUBLIC_ENDPOINTS.eventMembers.rateLimit.max).toBe(600);
    expect(PUBLIC_ENDPOINTS.search.rateLimit.max).toBe(120);
    expect(PUBLIC_ENDPOINTS.sources.rateLimit.max).toBe(300);
    expect(PUBLIC_ENDPOINTS.daily.rateLimit.max).toBe(300);
    expect(PUBLIC_ENDPOINTS.dailyByDate.rateLimit.max).toBe(300);
    expect(PUBLIC_ENDPOINTS.dailies.rateLimit.max).toBe(300);

    expect(publicRateLimitConfig("feed")).toEqual({
      family: "public-feed",
      windowMs: 60_000,
      max: 600,
    });
    expect(publicRateLimitConfig("dailyByDate")).toEqual({
      family: "public-daily",
      windowMs: 60_000,
      max: 300,
    });
    expect(PUBLIC_RATE_LIMIT_DEFAULT).toEqual({
      family: "public-default",
      windowMs: 60_000,
      max: 600,
    });
    expect(publicRateLimitLabel("search")).toBe("120 r/min");
    expect(publicRateLimitReqLabel("search")).toBe("120 req/min");
    expect(publicRateLimitPerIpLabel("search")).toBe("120/min/IP");
  });

  test("public endpoint cache policy has one runtime source of truth", () => {
    expect(PUBLIC_CACHE_DEFAULT).toEqual({
      sMaxAge: 60,
      staleWhileRevalidate: 300,
    });
    expect(publicCacheConfig("feed")).toEqual(PUBLIC_CACHE_DEFAULT);
    expect(publicCacheConfig("search")).toEqual(PUBLIC_CACHE_DEFAULT);
    expect(publicCacheConfig("item")).toEqual({
      sMaxAge: 120,
      staleWhileRevalidate: 600,
    });
    expect(publicCacheConfig("eventMembers")).toEqual({
      sMaxAge: 180,
      staleWhileRevalidate: 900,
    });
    expect(publicCacheConfig("sources")).toEqual({
      sMaxAge: 300,
      staleWhileRevalidate: 3600,
    });
    expect(publicCacheConfig("dailies")).toEqual({
      sMaxAge: 300,
      staleWhileRevalidate: 3600,
    });
    expect(publicCacheConfig("daily")).toEqual({
      sMaxAge: 300,
      staleWhileRevalidate: 86_400,
    });
    expect(publicCacheConfig("dailyByDate")).toEqual({
      sMaxAge: 3600,
      staleWhileRevalidate: 86_400,
    });
    expect(publicCacheHeaderLabel("dailyByDate")).toBe(
      "s-maxage=3600, stale-while-revalidate=86400",
    );
  });

  test("public route handlers delegate endpoint rate-limit/cache/ETag wiring to shared helpers", () => {
    for (const [key, path] of routeContracts) {
      const source = readProjectFile(path);
      expect(source).toContain("@/lib/api/public-helpers");
      expect(source).toContain(`publicEndpointRateLimit(req, "${key}")`);
      expect(source).toContain("publicCachedJson(req,");
      expect(source).not.toContain("publicRateLimitConfig");
      expect(source).not.toContain("publicCacheConfig");
      expect(source).not.toContain("publicRateLimit(req");
      expect(source).not.toContain("ifNoneMatch(");
      expect(source).not.toContain("notModified(");
      expect(source).not.toContain("publicJson(");
      expect(source).not.toContain('console.error("[api/public');
      expect(source).not.toContain('publicError("server_error"');
      expect(source).not.toContain("windowMs: 60_000");
      expect(source).not.toMatch(/max: (600|300|120)/);
      expect(source).not.toContain('family: "public-');
      expect(source).not.toMatch(/sMaxAge: (60|120|180|300|3600)/);
      expect(source).not.toMatch(/staleWhileRevalidate: (300|600|900|3600|86_400)/);
    }
  });

  test("agent-facing runtime surfaces render labels/counts from the shared contract", async () => {
    const skillSource = readProjectFile("app/skill.md/route.ts");
    const agentsTabsSource = readProjectFile("app/[locale]/agents/_tabs.tsx");
    const agentsPageSource = readProjectFile("app/[locale]/agents/page.tsx");
    const openApiSource = readProjectFile("app/openapi.yaml/route.ts");

    expect(skillSource).toContain("PUBLIC_RATE_LIMIT_DOC_GROUPS");
    expect(skillSource).toContain("publicRateLimitLabel");
    expect(agentsTabsSource).toContain("PUBLIC_RATE_LIMIT_DOC_GROUPS");
    expect(agentsTabsSource).toContain("publicRateLimitReqLabel");
    expect(agentsPageSource).toContain("PUBLIC_ENDPOINT_COUNT");
    expect(agentsPageSource).not.toContain("const ENDPOINT_COUNT = 8");
    expect(openApiSource).toContain("publicRateLimitPerIpLabel");

    const [skillRes, openApiRes] = await Promise.all([
      getSkillMarkdown(),
      getOpenApiYaml(),
    ]);
    const [skillText, openApiText] = await Promise.all([
      skillRes.text(),
      openApiRes.text(),
    ]);

    for (const group of PUBLIC_RATE_LIMIT_DOC_GROUPS) {
      expect(skillText).toContain(publicRateLimitLabel(group.keys[0]));
      expect(skillText).toContain(group.skillEndpoints.join(" "));
    }
    expect(openApiText).toContain(
      `(${publicRateLimitPerIpLabel("search")}) due to LLM cost`,
    );
  });

  test("current docs describe the same rate-limit contract and contributor path", () => {
    const doc = readProjectFile("docs/agent-access/README.md");
    const configSource = readProjectFile("lib/api/public-endpoint-config.ts");

    expect(doc).toContain("lib/api/public-endpoint-config.ts");
    expect(doc).toContain('publicEndpointRateLimit(req, "<endpoint-key>")');
    expect(doc).toContain('publicCachedJson(req, { endpoint: "<endpoint-key>"');
    expect(doc).toContain("Cache headers are centralized");
    expect(configSource).toContain("PUBLIC_RATE_LIMIT_DOC_GROUPS");

    for (const group of PUBLIC_RATE_LIMIT_DOC_GROUPS) {
      const label = `${publicRateLimitLabel(group.keys[0])}/IP`;
      expect(doc).toContain(label);
      expect(doc).toContain(group.docsEndpoints[0]);
    }
    expect(doc).not.toContain(
      'publicRateLimit(req, { family: "public-<name>", windowMs: 60_000, max: ... })',
    );
    expect(doc).not.toContain(
      'publicRateLimit(req, publicRateLimitConfig("<endpoint-key>"))',
    );
  });
});
