import { describe, expect, test } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const source = readSource("app/api/sources/active/route.ts");

describe("active sources route source wiring", () => {
  test("delegates payload lookup and plain JSON envelopes", () => {
    expect(source).toContain("@/lib/api/plain-response");
    expect(source).toContain("@/lib/public-content/http");
    expect(source).toContain("activeSourcesSnapshotBody");
    expect(source).toContain("readPublicSnapshot");
    expect(source).toContain("plainJson");
    expect(source).toContain("runPlainRoute");
    expect(source).toContain('serverErrorLabel: "api/sources/active"');
    expect(source).not.toContain("@/db/client");
    expect(source).not.toContain("@/db/schema");
    expect(source).not.toContain("from \"drizzle-orm\"");
    expect(source).not.toContain(".select({");
    expect(source).not.toContain("plainServerError");
    expect(source).not.toContain("try {");
    expect(source).not.toContain("catch (");
    expect(source).not.toContain("Response.json(");
    expect(source).not.toContain('console.error("[api/sources');
  });
});
