import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GET as getOpenApiYaml } from "@/app/openapi.yaml/route";
import { GET as getSkillMarkdown } from "@/app/skill.md/route";
import {
  PUBLIC_RATE_LIMIT_DOC_GROUPS,
  PUBLIC_RATE_LIMIT_DEFAULT,
  PUBLIC_RATE_LIMITS,
  PUBLIC_RATE_LIMIT_WINDOW_MS,
  publicRateLimitConfig,
  publicRateLimitLabel,
  publicRateLimitPerIpLabel,
  publicRateLimitReqLabel,
} from "@/lib/rate-limit/public-config";

const root = process.cwd();

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

function readProjectFile(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("public API rate-limit contract", () => {
  test("public endpoint limits have one runtime source of truth", () => {
    expect(PUBLIC_RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(PUBLIC_RATE_LIMITS.feed.max).toBe(600);
    expect(PUBLIC_RATE_LIMITS.item.max).toBe(600);
    expect(PUBLIC_RATE_LIMITS.eventMembers.max).toBe(600);
    expect(PUBLIC_RATE_LIMITS.search.max).toBe(120);
    expect(PUBLIC_RATE_LIMITS.sources.max).toBe(300);
    expect(PUBLIC_RATE_LIMITS.daily.max).toBe(300);
    expect(PUBLIC_RATE_LIMITS.dailyByDate.max).toBe(300);
    expect(PUBLIC_RATE_LIMITS.dailies.max).toBe(300);

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

  test("public route handlers select named limit keys instead of repeating numbers", () => {
    for (const [key, path] of routeContracts) {
      const source = readProjectFile(path);
      expect(source).toContain("@/lib/rate-limit/public-config");
      expect(source).toContain(`publicRateLimitConfig("${key}")`);
      expect(source).not.toContain("windowMs: 60_000");
      expect(source).not.toMatch(/max: (600|300|120)/);
      expect(source).not.toContain('family: "public-');
    }
  });

  test("agent-facing runtime surfaces render labels from the shared contract", async () => {
    const skillSource = readProjectFile("app/skill.md/route.ts");
    const agentsTabsSource = readProjectFile("app/[locale]/agents/_tabs.tsx");
    const openApiSource = readProjectFile("app/openapi.yaml/route.ts");

    expect(skillSource).toContain("PUBLIC_RATE_LIMIT_DOC_GROUPS");
    expect(skillSource).toContain("publicRateLimitLabel");
    expect(agentsTabsSource).toContain("PUBLIC_RATE_LIMIT_DOC_GROUPS");
    expect(agentsTabsSource).toContain("publicRateLimitReqLabel");
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
    const configSource = readProjectFile("lib/rate-limit/public-config.ts");

    expect(doc).toContain("lib/rate-limit/public-config.ts");
    expect(doc).toContain('publicRateLimitConfig("<endpoint-key>")');
    expect(configSource).toContain("PUBLIC_RATE_LIMIT_DOC_GROUPS");

    for (const group of PUBLIC_RATE_LIMIT_DOC_GROUPS) {
      const label = `${publicRateLimitLabel(group.keys[0])}/IP`;
      expect(doc).toContain(label);
      expect(doc).toContain(group.docsEndpoints[0]);
    }
    expect(doc).not.toContain(
      'publicRateLimit(req, { family: "public-<name>", windowMs: 60_000, max: ... })',
    );
  });
});
