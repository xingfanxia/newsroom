import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

const root = process.cwd();
const v1SourcesRoute = readFileSync(
  resolve(root, "app/api/v1/sources/route.ts"),
  "utf8",
);
const publicSourcesRoute = readFileSync(
  resolve(root, "app/api/public/sources/route.ts"),
  "utf8",
);
const agentsTabs = readFileSync(
  resolve(root, "app/[locale]/agents/_tabs.tsx"),
  "utf8",
);
const mainFeedRssRoute = readFileSync(
  resolve(root, "app/api/feed/[locale]/rss.xml/route.ts"),
  "utf8",
);
const sourcesPage = readFileSync(
  resolve(root, "app/[locale]/sources/page.tsx"),
  "utf8",
);
const readme = readFileSync(resolve(root, "README.md"), "utf8");
const docsReadme = readFileSync(resolve(root, "docs/README.md"), "utf8");
const agentMcpPlan = readFileSync(
  resolve(root, "docs/AGENT-MCP-PLAN.md"),
  "utf8",
);
const architectureDoc = readFileSync(
  resolve(root, "docs/architecture/ingestion.md"),
  "utf8",
);
const handoffDoc = readFileSync(resolve(root, "docs/HANDOFF.md"), "utf8");
const schema = readFileSync(resolve(root, "db/schema.ts"), "utf8");
const sourceCatalog = readFileSync(
  resolve(root, "lib/api/source-catalog.ts"),
  "utf8",
);
const removeErroredSourcesScript = readFileSync(
  resolve(root, "scripts/ops/remove-errored-sources.ts"),
  "utf8",
);
const types = readFileSync(resolve(root, "lib/types.ts"), "utf8");
const openapiRoute = readFileSync(
  resolve(root, "app/openapi.yaml/route.ts"),
  "utf8",
);

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
    expect(schema).toContain('pgEnum("health_status", SOURCE_HEALTH_STATUSES)');
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
    expect(schema).toContain('pgEnum("source_kind", SOURCE_KINDS)');
    expect(schema).toContain('pgEnum("source_group", SOURCE_GROUPS)');
    expect(schema).toContain('pgEnum("cadence", CADENCES)');
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
