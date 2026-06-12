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

  it("supports an all-time usage window across admin, API, and MCP surfaces", () => {
    expect(stats).toContain('"all"');
    expect(page).toContain('"all"');
    expect(route).toContain('"all"');
    expect(mcp).toContain('"all"');
  });

  it("includes task-level model breakdowns for the task spend table", () => {
    expect(stats).toContain("type TaskModelBreakdown");
    expect(stats).toContain("models: TaskModelBreakdown[]");
    expect(page).toContain("formatTaskModels(t.models)");
    expect(route).toContain("models: t.models");
  });

  it("renders model labels in recent calls", () => {
    expect(page).toContain("{zh ? \"模型\" : \"model\"}");
    expect(page).toContain("{c.model}");
  });
});
