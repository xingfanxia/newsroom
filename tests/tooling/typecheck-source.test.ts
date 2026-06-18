import { describe, expect, test } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const packageJson = JSON.parse(readSource("package.json")) as {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const handoffDoc = readSource("docs/HANDOFF.md");

describe("standalone TypeScript tooling source contract", () => {
  test("typecheck is a first-class quality gate with Bun runtime types", () => {
    expect(packageJson.scripts?.typecheck).toBe("tsc --noEmit");
    expect(packageJson.devDependencies).toHaveProperty("@types/bun");

    expect(handoffDoc).toContain("`bun run typecheck`");
    expect(handoffDoc).toContain("tests plus Bun runtime APIs");
    expect(handoffDoc).not.toContain("`bunx tsc --noEmit` still fails");
    expect(handoffDoc).not.toContain("repo test typing does not expose `bun:test`");
  });
});
