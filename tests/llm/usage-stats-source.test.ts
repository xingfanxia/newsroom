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
    expect(page).toContain("USAGE_RANGE_LABELS");
    expect(page).not.toContain('const RANGES = ["today", "week", "month", "all"]');
    expect(page).not.toContain("const RANGE_LABEL");
    expect(summary).toContain("USAGE_WINDOWS");
    expect(summary).toContain("usageSummaryWindowSchema");
    expect(summary).toContain("DEFAULT_USAGE_WINDOW");
    expect(summary).not.toContain('export const USAGE_WINDOWS = ["today", "week", "month", "all"]');
    expect(route).toContain("parseUsageSummaryQueryRequest");
    expect(mcp).toContain("usageSummaryWindowSchema");
    expect(mcp).toContain("usageWindowOrDefault");
  });

  it("includes task-level model breakdowns for the task spend table", () => {
    expect(stats).toContain("type TaskModelBreakdown");
    expect(stats).toContain("models: TaskModelBreakdown[]");
    expect(page).toContain("formatUsageTaskModels(t.models)");
    expect(summary).toContain("models: t.models.map");
  });

  it("renders model labels in recent calls", () => {
    expect(page).toContain("{zh ? \"模型\" : \"model\"}");
    expect(page).toContain("{c.model}");
  });

  it("keeps usage presentation helpers out of the admin page component", () => {
    expect(page).toContain("@/lib/llm/usage-display");
    expect(page).toContain("usageTaskTone(c.task)");
    expect(page).toContain("formatUsageTaskModels(t.models)");
    expect(page).not.toContain("function taskPillColor");
    expect(page).not.toContain("function formatTokens");
    expect(page).not.toContain("function formatNumber");
    expect(page).not.toContain("function formatTaskModels");
    expect(page).not.toContain("function formatShortDate");
  });

  it("keeps the admin usage page on the shared usage summary boundary", () => {
    expect(page).toContain("@/lib/api/usage-summary");
    expect(page).toContain("getUsageDashboardSummary");
    expect(summary).toContain("export async function getUsageDashboardSummary");
    expect(summary).toContain("dailySpend(opts.dailyDays");
    expect(page).not.toContain("@/lib/llm/stats");
    expect(page).not.toContain("totalsByWindow(");
    expect(page).not.toContain("breakdownByTask(");
    expect(page).not.toContain("breakdownByModel(");
    expect(page).not.toContain("recentCalls(");
    expect(page).not.toContain("dailySpend(");
  });

  it("v1 and MCP usage share the same agent summary contract", () => {
    expect(route).toContain("@/lib/api/usage-summary");
    expect(mcp).toContain("@/lib/api/usage-summary");
    expect(route).toContain("getUsageSummary");
    expect(mcp).toContain("getUsageSummary");
    expect(route).toContain("parseUsageSummaryQueryRequest");
    expect(route).not.toContain('from "zod"');
    expect(route).not.toContain("parseQueryParams");
    expect(mcp).toContain("usageSummaryWindowSchema");
    expect(mcp).toContain("usageWindowOrDefault");
    expect(mcp).not.toContain('window: z.enum(USAGE_WINDOWS).optional()');
    expect(mcp).not.toContain('window ?? "week"');
    expect(route).not.toContain("totalsByWindow");
    expect(route).not.toContain("breakdownByTask");
    expect(mcp).not.toContain("totalsByWindow");
    expect(summary).toContain("by_task");
    expect(summary).toContain("by_model");
    expect(summary).toContain("recent_calls");
  });
});
