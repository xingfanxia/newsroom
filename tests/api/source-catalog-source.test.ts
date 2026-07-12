import { describe, expect, test } from "bun:test";
import { GET as getOpenApiYaml } from "@/app/openapi.yaml/route";
import {
  APP_LOCALES,
  CADENCES,
  FEED_VIEWS,
  ITEM_TIERS,
  SEARCH_MODES,
  SOURCE_GROUPS,
  SOURCE_HEALTH_STATUSES,
  SOURCE_KINDS,
  SOURCE_LOCALES,
  VISIBLE_ITEM_TIERS,
} from "@/lib/types";
import { readSource } from "@/tests/helpers/source";

const v1SourcesRoute = readSource("app/api/v1/sources/route.ts");
const publicSourcesRoute = readSource("app/api/public/sources/route.ts");
const agentsTabs = readSource("app/[locale]/agents/_tabs.tsx");
const mainFeedRssRoute = readSource("app/api/feed/[locale]/rss.xml/route.ts");
const sourcesPage = readSource("app/[locale]/sources/page.tsx");
const readme = readSource("README.md");
const docsReadme = readSource("docs/README.md");
const agentMcpPlan = readSource("docs/AGENT-MCP-PLAN.md");
const architectureDoc = readSource("docs/architecture/ingestion.md");
const handoffDoc = readSource("docs/HANDOFF.md");
const liveSources = readSource("lib/sources/live.ts");
const schema = readSource("db/schema.ts");
const sourceCatalog = readSource("lib/api/source-catalog.ts");
const removeErroredSourcesScript = readSource(
  "scripts/ops/remove-errored-sources.ts",
);
const types = readSource("lib/types.ts");
const openapiRoute = readSource("app/openapi.yaml/route.ts");

function inlineEnum(values: readonly (string | null)[]): string {
  return `[${values.map((value) => (value === null ? "null" : value)).join(", ")}]`;
}

describe("source catalog source wiring", () => {
  test("public and v1 routes delegate source serialization to the shared module", () => {
    for (const source of [v1SourcesRoute, publicSourcesRoute]) {
      expect(source).toContain("@/lib/api/source-catalog");
      expect(source).toContain("listSourceCatalogRows");
      expect(source).not.toContain(".select({");
      expect(source).not.toContain("sourceHealth.");
    }
    expect(v1SourcesRoute).toContain("rows.map(toV1SourceApiItem)");
    expect(publicSourcesRoute).toContain("rows.map(toPublicSourceApiItem)");
  });

  test("OpenAPI documents the runtime source health enum", () => {
    expect(types).toContain("export const SOURCE_HEALTH_STATUSES");
    expect(schema).toContain('text("status", { enum: SOURCE_HEALTH_STATUSES })');
    expect(openapiRoute).toContain("SOURCE_HEALTH_STATUSES");
    expect(sourceCatalog).toContain("SourceHealthStatus");
    expect(sourceCatalog).toContain("DEFAULT_SOURCE_HEALTH_STATUS");
    expect(removeErroredSourcesScript).toContain("SourceHealthStatus");
    expect(removeErroredSourcesScript).toContain("DISABLED_SOURCE_HEALTH_STATUS");
    expect(openapiRoute).not.toContain(
      "status: { type: string, enum: [ok, warning, error, pending] }",
    );
    expect(removeErroredSourcesScript).not.toContain(
      "health_status enum is (ok | warning | error | pending)",
    );
    expect(openapiRoute).not.toContain("enum: [ok, degraded, error, pending]");
  });

  test("source group/kind/cadence enums have one runtime source of truth", () => {
    expect(types).toContain("export const SOURCE_KINDS");
    expect(types).toContain("export const SOURCE_GROUPS");
    expect(types).toContain("export const CADENCES");
    expect(schema).toContain('text("kind", { enum: SOURCE_KINDS })');
    expect(schema).toContain('text("group", { enum: SOURCE_GROUPS })');
    expect(schema).toContain('text("cadence", { enum: CADENCES })');
  });

  test("OpenAPI derives shared public contract enums from runtime tuples", () => {
    expect(openapiRoute).toContain("@/lib/types");
    for (const tupleName of [
      "APP_LOCALES",
      "CADENCES",
      "FEED_VIEWS",
      "ITEM_TIERS",
      "SEARCH_MODES",
      "SOURCE_GROUPS",
      "SOURCE_HEALTH_STATUSES",
      "SOURCE_KINDS",
      "SOURCE_LOCALES",
      "VISIBLE_ITEM_TIERS",
    ]) {
      expect(openapiRoute).toContain(tupleName);
    }
    expect(openapiRoute).toContain("yamlInlineEnum");
    expect(openapiRoute).not.toContain("description: 52 sources monitored");

    for (const duplicatedEnum of [
      "enum: [featured, p1, all], default: featured",
      "enum: [featured, p1, all], default: all",
      "enum: [featured, p1, all, excluded]",
      "enum: [today, archive]",
      "enum: [lexical, semantic]",
      "enum: [ok, warning, error, pending]",
      "enum: [vendor-official, media, newsletter, research, social, product, podcast, policy, market]",
      "enum: [rss, atom, api, rsshub, scrape, x-api, aihot-api]",
      "enum: [live, hourly, daily, weekly]",
      "enum: [zh, en]",
    ]) {
      expect(openapiRoute).not.toContain(duplicatedEnum);
    }

    expect(openapiRoute).not.toContain(
      "source_group, in: query, schema: { type: string }",
    );
    expect(openapiRoute).not.toContain(
      "source_kind, in: query, schema: { type: string }",
    );
  });

  test("OpenAPI response expands shared runtime tuples for clients", async () => {
    const res = await getOpenApiYaml();
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/yaml");
    for (const values of [
      APP_LOCALES,
      CADENCES,
      FEED_VIEWS,
      ITEM_TIERS,
      SEARCH_MODES,
      SOURCE_KINDS,
      SOURCE_HEALTH_STATUSES,
      SOURCE_LOCALES,
      VISIBLE_ITEM_TIERS,
    ]) {
      expect(text).toContain(`enum: ${inlineEnum(values)}`);
    }
    expect(text).toContain(`enum: ${inlineEnum(SOURCE_GROUPS)}`);
    expect(text).toContain(`enum: ${inlineEnum([...SOURCE_GROUPS, null])}`);
    expect(text).not.toContain("52 sources monitored");
  });

  test("sources page uses shared group order and labels", () => {
    expect(sourcesPage).toContain("@/lib/sources/groups");
    expect(sourcesPage).toContain("SOURCE_GROUPS");
    expect(sourcesPage).toContain("SOURCE_GROUP_LABELS");
    expect(sourcesPage).not.toContain("const GROUP_ORDER");
    expect(sourcesPage).not.toContain("const GROUP_LABELS");
  });

  test("source serializers reuse the shared nullable ISO helper", () => {
    expect(sourceCatalog).toContain("@/lib/time/relative");
    expect(sourceCatalog).toContain("toIsoStringOrNull");
    expect(publicSourcesRoute).toContain("toIsoStringOrNull");
    expect(liveSources).toContain("toIsoStringOrNull");
    expect(sourceCatalog).not.toContain("function iso(");
    expect(publicSourcesRoute).not.toContain("lastSuccessAt?.toISOString()");
    expect(liveSources).not.toContain("hLastFetched?.toISOString()");
    expect(liveSources).not.toContain("hLastSuccess?.toISOString()");
  });

  test("current docs and public agent copy avoid fixed source-count claims", () => {
    const currentCopy = [
      readme,
      architectureDoc,
      handoffDoc,
      agentsTabs,
      mainFeedRssRoute,
      openapiRoute,
    ].join("\n");

    for (const staleCount of [
      "50+ sources in",
      "50+ sources",
      "50+ 来源",
      "~50 feeds",
      "41 RSS/Atom/RSSHub sources",
      "41 sources seeded",
      "45 sources",
      "52 sources monitored",
      "52-source catalog",
      "59+ source catalog",
      "59+ 源目录",
      "59-source catalog",
    ]) {
      expect(currentCopy).not.toContain(staleCount);
    }
  });

  test("historical agent MCP plan is clearly archived", () => {
    expect(docsReadme).toContain("[`AGENT-MCP-PLAN.md`](./AGENT-MCP-PLAN.md)");
    expect(agentMcpPlan.slice(0, 700)).toContain("Historical archive");
    expect(agentMcpPlan.slice(0, 700)).toContain("agent-access/README.md");
    expect(agentMcpPlan.slice(0, 700)).toContain("lib/types.ts");
  });
});
