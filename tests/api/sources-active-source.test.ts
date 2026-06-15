import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "app/api/sources/active/route.ts"),
  "utf8",
);

describe("active sources route source wiring", () => {
  test("delegates payload lookup and plain JSON envelopes", () => {
    expect(source).toContain("@/lib/api/plain-response");
    expect(source).toContain("@/lib/api/source-catalog");
    expect(source).toContain("getActiveSourcesRoutePayload");
    expect(source).toContain("plainJson");
    expect(source).toContain("plainServerError");
    expect(source).not.toContain("@/db/client");
    expect(source).not.toContain("@/db/schema");
    expect(source).not.toContain("from \"drizzle-orm\"");
    expect(source).not.toContain(".select({");
    expect(source).not.toContain("Response.json(");
    expect(source).not.toContain('console.error("[api/sources');
  });
});
