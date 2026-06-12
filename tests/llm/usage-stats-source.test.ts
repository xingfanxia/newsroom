import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

describe("usage stats surfaces", () => {
  const stats = readFileSync(resolve(root, "lib/llm/stats.ts"), "utf8");
  const page = readFileSync(
    resolve(root, "app/[locale]/admin/usage/page.tsx"),
    "utf8",
  );
  const route = readFileSync(
    resolve(root, "app/api/v1/usage/summary/route.ts"),
    "utf8",
  );
  const mcp = readFileSync(resolve(root, "app/api/mcp/route.ts"), "utf8");
  const summary = readFileSync(resolve(root, "lib/api/usage-summary.ts"), "utf8");

  it("supports an all-time usage window across admin, API, and MCP surfaces", () => {
    expect(stats).toContain("export const USAGE_WINDOWS");
    expect(stats).toContain('"all"');
    expect(page).toContain("USAGE_WINDOWS");
    expect(page).not.toContain('const RANGES = ["today", "week", "month", "all"]');
    expect(summary).toContain("USAGE_WINDOWS");
    expect(summary).not.toContain('export const USAGE_WINDOWS = ["today", "week", "month", "all"]');
    expect(route).toContain("USAGE_WINDOWS");
    expect(mcp).toContain("USAGE_WINDOWS");
  });

  it("includes task-level model breakdowns for the task spend table", () => {
    expect(stats).toContain("type TaskModelBreakdown");
    expect(stats).toContain("models: TaskModelBreakdown[]");
    expect(page).toContain("formatTaskModels(t.models)");
    expect(summary).toContain("models: t.models.map");
  });

  it("renders model labels in recent calls", () => {
    expect(page).toContain("{zh ? \"模型\" : \"model\"}");
    expect(page).toContain("{c.model}");
  });

  it("v1 and MCP usage share the same agent summary contract", () => {
    expect(route).toContain("@/lib/api/usage-summary");
    expect(mcp).toContain("@/lib/api/usage-summary");
    expect(route).toContain("getUsageSummary");
    expect(mcp).toContain("getUsageSummary");
    expect(route).not.toContain("totalsByWindow");
    expect(route).not.toContain("breakdownByTask");
    expect(mcp).not.toContain("totalsByWindow");
    expect(summary).toContain("by_task");
    expect(summary).toContain("by_model");
    expect(summary).toContain("recent_calls");
  });
});
