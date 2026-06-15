import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

const routePaths = [
  "app/api/events/[id]/members/route.ts",
  "app/api/public/events/[id]/members/route.ts",
  "app/api/v1/events/[id]/members/route.ts",
] as const;
const mcpRoutePath = "app/api/mcp/route.ts";

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

  test("routes keep their intended locale defaults", () => {
    expect(read("app/api/events/[id]/members/route.ts")).toContain(
      'defaultLocale: "zh"',
    );
    expect(read("app/api/v1/events/[id]/members/route.ts")).toContain(
      'defaultLocale: "zh"',
    );
    expect(read("app/api/public/events/[id]/members/route.ts")).toContain(
      'defaultLocale: "en"',
    );
  });

  test("legacy UI event-member route delegates plain JSON envelopes", () => {
    const source = read("app/api/events/[id]/members/route.ts");

    expect(source).toContain("@/lib/api/plain-response");
    expect(source).toContain("toEventMembersListEnvelope");
    expect(source).toContain("plainJson");
    expect(source).toContain("plainError");
    expect(source).toContain("plainServerError");
    expect(source).not.toContain("Response.json(");
    expect(source).not.toContain('console.error("[api/events');
  });

  test("public route keeps only public cache/rate-limit behavior locally", () => {
    const source = read("app/api/public/events/[id]/members/route.ts");

    expect(source).toContain("publicCachedRoute");
    expect(source).toContain('endpoint: "eventMembers"');
    expect(source).not.toContain("publicEndpointRateLimit(");
    expect(source).not.toContain("publicCachedJson(req,");
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
