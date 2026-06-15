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

  test("uses a rolling current-year source window instead of stale fixed dates", () => {
    expect(source).toContain("date_trunc('year', now())");
    expect(source).toContain("interval '1 year'");
    expect(source).toContain("=== top current-year sources ===");
    expect(source).not.toContain("2026-04-30");
    expect(source).not.toContain("=== top 2026 sources ===");
  });

  test("names commentary counters after the current tier-gated fields", () => {
    expect(source).toContain("AS with_editor_note");
    expect(source).toContain("AS with_editor_analysis");
    expect(source).toContain("editor_note_zh IS NOT NULL");
    expect(source).toContain("editor_analysis_zh IS NOT NULL");
    expect(source).not.toContain("AS with_commentary");
  });
});
