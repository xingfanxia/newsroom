import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "app/api/sources/active/route.ts"),
  "utf8",
);

describe("active sources route source wiring", () => {
  test("delegates plain JSON success and server-error envelopes", () => {
    expect(source).toContain("@/lib/api/plain-response");
    expect(source).toContain("plainJson");
    expect(source).toContain("plainServerError");
    expect(source).not.toContain("Response.json(");
    expect(source).not.toContain('console.error("[api/sources');
  });
});
