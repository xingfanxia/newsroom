import { describe, expect, test } from "bun:test";
import { readSource, routeFilesUnder } from "@/tests/helpers/source";

describe("agent bearer auth source wiring", () => {
  test("v1 and MCP use the same bearer-token helper", () => {
    const authHelper = readSource("lib/auth/api-token.ts");
    const v1Helper = readSource("lib/api/v1-route.ts");
    const mcpRoute = readSource("app/api/mcp/route.ts");

    expect(authHelper).toContain("bearer-gated agent endpoints");
    expect(authHelper).toContain("/api/v1/*");
    expect(authHelper).toContain("/api/mcp");
    expect(authHelper).not.toContain("Bearer-token auth for /api/v1/* endpoints");

    expect(v1Helper).toContain(
      'import { requireApiToken } from "@/lib/auth/api-token"',
    );
    expect(mcpRoute).toContain(
      'import { requireApiToken } from "@/lib/auth/api-token"',
    );
    expect(mcpRoute).toContain("const auth = await requireApiToken(req)");
    expect(mcpRoute).not.toContain('headers.get("authorization")');
    expect(mcpRoute).not.toContain("headers.get('authorization')");
    expect(mcpRoute).not.toContain("invalid_token");
    expect(mcpRoute).not.toContain("missing_bearer");
  });

  test("v1 leaf routes keep auth behind the route helper", () => {
    for (const path of routeFilesUnder("app/api/v1").sort()) {
      const source = readSource(path);
      expect(source, path).toContain("@/lib/api/v1-route");
      expect(source, path).not.toContain("@/lib/auth/api-token");
      expect(source, path).not.toContain("requireApiToken(");
    }
  });

  test("current agent docs describe the shared auth boundary", () => {
    const agentDocs = readSource("docs/agent-access/README.md");
    const handoff = readSource("docs/HANDOFF.md");

    expect(agentDocs).toContain("lib/auth/api-token.ts");
    expect(agentDocs).toContain("/api/v1/*");
    expect(agentDocs).toContain("/api/mcp");
    expect(agentDocs).toContain("shared agent bearer auth");
    expect(handoff).toContain("/api/v1/*");
    expect(handoff).toContain("/api/mcp");
    expect(handoff).not.toContain("verifyApiToken(req)");
    expect(handoff).not.toContain("app/api/mcp/sse/route.ts");
    expect(handoff).not.toContain("/api/mcp/sse");
  });
});
