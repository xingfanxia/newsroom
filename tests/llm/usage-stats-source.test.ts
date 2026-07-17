import { describe, expect, it } from "bun:test";
import { readSource } from "@/tests/helpers/source";

describe("usage stats surfaces", () => {
  const stats = readSource("lib/llm/stats.ts");
  const page = readSource("app/[locale]/admin/usage/page.tsx");
  const usageTables = readSource("app/[locale]/admin/usage/_usage-tables.tsx");
  const systemPage = readSource("app/[locale]/admin/system/page.tsx");
  const adminSectionHeader = readSource("components/admin/section-header.tsx");
  const adminTableFrame = readSource("components/admin/table-frame.tsx");
  const route = readSource("app/api/v1/usage/summary/route.ts");
  const mcp = readSource("app/api/mcp/route.ts");
  const summary = readSource("lib/api/usage-summary.ts");

  it("supports an all-time usage window across admin, API, and MCP surfaces", () => {
    expect(stats).toContain("export const USAGE_WINDOWS");
    expect(stats).toContain('"all"');
    expect(page).toContain("USAGE_WINDOWS");
    expect(page).toContain("USAGE_RANGE_LABELS");
    expect(page).toContain("usageWindowFromParam(sp.range)");
    expect(page).not.toContain("USAGE_WINDOWS as readonly string[]");
    expect(page).not.toContain("sp.range as WindowKey");
    expect(page).toContain("usageRangeLabel(\"today\", usageLocale)");
    expect(page).toContain("usageRangeLabel(\"all\", usageLocale)");
    expect(page).not.toContain('const RANGES = ["today", "week", "month", "all"]');
    expect(page).not.toContain("const RANGE_LABEL");
    expect(page).not.toContain('label={zh ? "近 7 天" : "7d"}');
    expect(page).not.toContain('label={zh ? "全量" : "all-time"}');
    expect(summary).toContain("USAGE_WINDOWS");
    expect(summary).toContain("usageSummaryWindowSchema");
    expect(summary).toContain("DEFAULT_USAGE_WINDOW");
    expect(summary).toContain("export function usageWindowFromParam");
    expect(summary).toContain("toUsageWindowTotalsRecord");
    expect(stats).toContain("USAGE_WINDOWS.map((usageWindow");
    expect(summary).not.toContain("windowTotals: { today, week, month, all }");
    expect(summary).not.toContain('export const USAGE_WINDOWS = ["today", "week", "month", "all"]');
    expect(route).toContain("parseUsageSummaryQueryRequest");
    expect(mcp).toContain("usageSummaryWindowSchema");
    expect(mcp).toContain("usageWindowOrDefault");
  });

  it("includes task-level model breakdowns for the task spend table", () => {
    expect(stats).toContain("type TaskModelBreakdown");
    expect(stats).toContain("models: TaskModelBreakdown[]");
    expect(usageTables).toContain("formatUsageTaskModels(t.models)");
    expect(usageTables).toContain("formatUsageModelLabel");
    expect(summary).toContain("models: t.models.map");
  });

  it("renders provider/model labels in recent calls", () => {
    expect(usageTables).toContain("{zh ? \"模型\" : \"model\"}");
    expect(usageTables).toContain("formatUsageModelLabel(c)");
    expect(usageTables).toContain('overflowWrap: "anywhere"');
    expect(usageTables).not.toContain("{c.model}");
  });

  it("keeps usage table presentation out of the admin page component", () => {
    expect(page).toContain("@/lib/llm/usage-display");
    expect(page).toContain("usageRangeLabel");
    expect(page).toContain("UsageBreakdownTables");
    expect(page).not.toContain("usageTaskTone(c.task)");
    expect(page).not.toContain("formatUsageTaskModels(t.models)");
    expect(usageTables).toContain("@/lib/llm/usage-display");
    expect(usageTables).toContain("usageTaskTone(c.task)");
    expect(usageTables).toContain("formatUsageTaskModels(t.models)");
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
    expect(summary).toContain("getUsageDashboardStats(window, opts)");
    expect(page).not.toContain("@/lib/llm/stats");
    expect(page).not.toContain("totalsByWindow(");
    expect(page).not.toContain("breakdownByTask(");
    expect(page).not.toContain("breakdownByModel(");
    expect(page).not.toContain("recentCalls(");
    expect(page).not.toContain("dailySpend(");
  });

  it("keeps admin usage aggregates on one rollup-backed Turso batch", () => {
    const rollup = readSource("lib/llm/usage-rollup-sql.ts");

    expect(stats).toContain("libsqlClient().batch");
    expect(stats).toContain("usageTotalsStatement");
    expect(stats).toContain("usageBreakdownStatement");
    expect(rollup).toContain("llm_usage_daily_rollups");
    expect(rollup).toContain("llm_usage_daily_rollup_ai");
    expect(stats).not.toContain("FROM llm_usage INDEXED BY llm_usage_totals_cover_idx");
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

  it("shares admin section headings instead of duplicating local h3 components", () => {
    expect(adminSectionHeader).toContain("export function AdminSectionHeader");
    expect(usageTables).toContain("@/components/admin/section-header");
    expect(systemPage).toContain("@/components/admin/section-header");
    expect(page).not.toContain("function SectionHeader");
    expect(systemPage).not.toContain("function SectionHeader");
  });

  it("shares admin table frames instead of repeating table shell styles", () => {
    expect(adminTableFrame).toContain("export function AdminTableFrame");
    expect(usageTables).toContain("@/components/admin/table-frame");
    expect(usageTables).toContain("<AdminTableFrame");
    expect(usageTables).not.toContain("function TableFrame");
    expect(systemPage).toContain("@/components/admin/table-frame");
    expect(systemPage).toContain("<AdminTableFrame>");
  });
});
