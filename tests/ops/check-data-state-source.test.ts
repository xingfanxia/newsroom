import { describe, expect, test } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const source = readSource("scripts/ops/check-data-state.ts");

describe("check-data-state operator diagnostic", () => {
  test("reuses the shared system snapshot for queue and cron telemetry", () => {
    expect(source).toContain("@/lib/shell/system-stats");
    expect(source).toContain("getSystemSnapshot()");
    expect(source).toContain("=== worker queues ===");
    expect(source).toContain("=== cron activity ===");
    expect(source).not.toContain("pending_normalize");
    expect(source).not.toContain("FROM llm_usage");
  });
});
