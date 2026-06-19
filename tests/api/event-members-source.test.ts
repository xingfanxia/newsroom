import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

const routePaths = [
  "app/api/events/[id]/members/route.ts",
  "app/api/public/events/[id]/members/route.ts",
  "app/api/v1/events/[id]/members/route.ts",
] as const;
const mcpRoutePath = "app/api/mcp/route.ts";
const defaultsPath = "lib/event-members/query-defaults.ts";

describe("event member route source wiring", () => {
  test("all HTTP event-member routes share route payload lookup", () => {
    for (const path of routePaths) {
      const source = read(path);

      expect(source).toContain("@/lib/api/event-members");
      expect(source).toContain("getEventMembersRequestPayload");
      expect(source).not.toContain("getEventMembersRoutePayload");
      expect(source).not.toContain("parseEventMemberRouteParams");
      expect(source).not.toContain("toEventMemberApiItems");
      expect(source).not.toContain("@/lib/items/live");
      expect(source).not.toContain("getEventMembers(");
      expect(source).not.toContain("const idSchema = z.coerce");
      expect(source).not.toContain("const localeSchema = z.enum");
      expect(source).not.toContain("new URL(req.url)");
      expect(source).not.toContain('searchParams.get("locale")');
    }
  });

  test("MCP event members shares the same payload builder", () => {
    const source = read(mcpRoutePath);

    expect(source).toContain("@/lib/api/event-members");
    expect(source).toContain("getEventMembersPayload");
    expect(source).not.toContain("toEventMemberApiItems");
    expect(source).not.toContain("getEventMembers(");
  });

  test("event-member locale defaults have one shared source", () => {
    const defaults = read(defaultsPath);
    const uiRoute = read("app/api/events/[id]/members/route.ts");
    const v1Route = read("app/api/v1/events/[id]/members/route.ts");
    const publicRoute = read("app/api/public/events/[id]/members/route.ts");
    const mcpRoute = read(mcpRoutePath);
    const openapi = read("app/openapi.yaml/route.ts");

    expect(defaults).toContain("DEFAULT_UI_EVENT_MEMBERS_LOCALE");
    expect(defaults).toContain("DEFAULT_V1_EVENT_MEMBERS_LOCALE");
    expect(defaults).toContain("DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE");
    expect(defaults).toContain("DEFAULT_MCP_EVENT_MEMBERS_LOCALE");
    expect(defaults).toContain("satisfies AppLocale");

    expect(uiRoute).toContain("DEFAULT_UI_EVENT_MEMBERS_LOCALE");
    expect(v1Route).toContain("DEFAULT_V1_EVENT_MEMBERS_LOCALE");
    expect(publicRoute).toContain("DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE");
    expect(mcpRoute).toContain("DEFAULT_MCP_EVENT_MEMBERS_LOCALE");
    expect(openapi).toContain("DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE");

    for (const source of [uiRoute, v1Route, publicRoute, mcpRoute]) {
      expect(source).not.toContain('defaultLocale: "zh"');
      expect(source).not.toContain('defaultLocale: "en"');
      expect(source).not.toContain("(default zh)");
      expect(source).not.toContain("(default en)");
    }
    expect(mcpRoute).not.toContain(
      'getEventMembersPayload(cluster_id, locale ?? "en")',
    );
    expect(openapi).not.toContain("default: en }");
  });

  test("legacy UI event-member route delegates plain JSON envelopes", () => {
    const source = read("app/api/events/[id]/members/route.ts");

    expect(source).toContain("@/lib/api/plain-response");
    expect(source).toContain("toEventMembersListEnvelope");
    expect(source).toContain("plainJson");
    expect(source).toContain("plainRouteResult");
    expect(source).toContain("runPlainRoute");
    expect(source).toContain('serverErrorLabel: "api/events/:id/members"');
    expect(source).not.toContain("plainError(result.error");
    expect(source).not.toContain("plainServerError");
    expect(source).not.toContain("try {");
    expect(source).not.toContain("catch (");
    expect(source).not.toContain("Response.json(");
    expect(source).not.toContain('console.error("[api/events');
  });

  test("public route keeps only public cache/rate-limit behavior locally", () => {
    const source = read("app/api/public/events/[id]/members/route.ts");

    expect(source).toContain("publicCachedRoute");
    expect(source).toContain("publicRouteResult(");
    expect(source).toContain('endpoint: "eventMembers"');
    expect(source).not.toContain("publicEndpointRateLimit(");
    expect(source).not.toContain("publicCachedJson(req,");
    expect(source).not.toContain("if (!result.ok) return result");
    expect(source).toContain("eventMembersCacheSignalParts");
    expect(source).toContain("etagSignal(eventMembersCacheSignalParts(body))");
    expect(source).not.toContain("body.members[body.members.length");
  });

  test("v1 route keeps only bearer-gated response behavior locally", () => {
    const source = read("app/api/v1/events/[id]/members/route.ts");

    expect(source).toContain("runV1Route");
    expect(source).toContain("toEventMembersListEnvelope");
    expect(source).not.toContain("members: result.payload.members");
    expect(source).not.toContain("total: result.payload.total");
  });
});
