import { describe, expect, test } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const docsIndex = readSource("docs/README.md");
const runbook = readSource("docs/operations/route-performance.md");

describe("route performance runbook documentation contract", () => {
  test("makes the new endpoint runbook discoverable and fail-closed for reads", () => {
    expect(docsIndex).toContain("new endpoint runbook and maintenance");
    expect(runbook).toContain("## New endpoint / route runbook");
    expect(runbook).toContain("`lib/public-content/entrypoints.ts`");
    expect(runbook).toContain(
      "`tests/tooling/public-entrypoints-inventory.test.ts`",
    );
    expect(runbook).toContain("page, `GET`, or `HEAD`");
    expect(runbook).toContain("POST-only");
  });

  test("requires explicit performance and data-access decisions before merge", () => {
    for (const contract of [
      "Data source",
      "Query / fan-out bound",
      "Cold target",
      "Warm target",
      "Decoded response cap",
      "Upstream-fetch cap",
      "Cache policy",
      "Rollback condition",
    ]) {
      expect(runbook).toContain(contract);
    }
    expect(runbook).toContain(
      "bun test tests/tooling/public-entrypoints-inventory.test.ts",
    );
    expect(runbook).toContain("bun run verify:public-boundary");
    expect(runbook).toContain("bun run verify");
  });

  test("defines recurring ownership, evidence, and re-audit triggers", () => {
    expect(runbook).toContain("## Maintenance");
    expect(runbook).toContain("Every route change");
    expect(runbook).toContain("After every deployment");
    expect(runbook).toContain("Monthly");
    expect(runbook).toMatch(/two consecutive warm\s+samples/);
    expect(runbook).toMatch(/doubles\s+from its last audited baseline/);
    expect(runbook).toContain("`docs/reports/route-performance/`");
  });
});
