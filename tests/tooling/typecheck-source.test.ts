import { describe, expect, test } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const packageJson = JSON.parse(readSource("package.json")) as {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const handoffDoc = readSource("docs/HANDOFF.md");

describe("standalone TypeScript tooling source contract", () => {
  test("typecheck and verify are first-class quality gates", () => {
    expect(packageJson.scripts?.typecheck).toBe("tsc --noEmit");
    expect(packageJson.scripts?.verify).toBe(
      "bun scripts/verification/run-hermetic-verify.ts",
    );
    expect(packageJson.scripts?.test).toBe(
      "bun scripts/verification/run-hermetic-tests.ts",
    );
    expect(packageJson.devDependencies).toHaveProperty("@types/bun");

    expect(handoffDoc).toContain("`bun run verify`");
    expect(handoffDoc).toContain("one-command local quality gate");
    expect(handoffDoc).toContain("`bun run typecheck`");
    expect(handoffDoc).toContain("tests plus Bun runtime APIs");
    expect(handoffDoc).not.toContain("`bunx tsc --noEmit` still fails");
    expect(handoffDoc).not.toContain("repo test typing does not expose `bun:test`");
  });
});
