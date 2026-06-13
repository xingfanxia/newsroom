import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const routePaths = [
  "app/api/events/[id]/members/route.ts",
  "app/api/public/events/[id]/members/route.ts",
  "app/api/v1/events/[id]/members/route.ts",
] as const;
const mcpRoutePath = "app/api/mcp/route.ts";

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("event member route source wiring", () => {
  test("all HTTP event-member routes share route payload lookup", () => {
    for (const path of routePaths) {
      const source = read(path);

      expect(source).toContain("@/lib/api/event-members");
      expect(source).toContain("getEventMembersRoutePayload");
      expect(source).not.toContain("parseEventMemberRouteParams");
      expect(source).not.toContain("toEventMemberApiItems");
      expect(source).not.toContain("@/lib/items/live");
      expect(source).not.toContain("getEventMembers(");
      expect(source).not.toContain("const idSchema = z.coerce");
      expect(source).not.toContain("const localeSchema = z.enum");
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
});
