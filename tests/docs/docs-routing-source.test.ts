import { readdirSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { readSource, sourcePath } from "@/tests/helpers/source";

const rootReadme = readSource("README.md");
const docsReadme = readSource("docs/README.md");
const handoffDoc = readSource("docs/HANDOFF.md");
const architectureOverviewDoc = readSource("docs/architecture/overview.md");
const ingestionDoc = readSource("docs/architecture/ingestion.md");
const testingStrategyDoc = readSource("docs/testing/strategy.md");
const dailyColumnDesign = readSource("docs/daily-column/DESIGN.md");
const dailyColumnPlan = readSource("docs/daily-column/PLAN.md");
const dailyColumnHandoff = readSource("docs/daily-column/HANDOFF-2026-04-25.md");
const aggregationHandoff = readSource("docs/HANDOFF-AGGREGATION.md");
const aggregationDesign = readSource("docs/aggregation/DESIGN.md");
const aggregationPlan = readSource("docs/aggregation/PLAN.md");
const aihotPlan = readSource("docs/aihot-integration/PLAN.md");
const agentMcpPlan = readSource("docs/AGENT-MCP-PLAN.md");
const session8Punchlist = readSource("docs/SESSION8-PUNCHLIST.md");
const aggregationHandoffFiles = readdirSync(sourcePath("docs/aggregation"))
  .filter((name) => /^HANDOFF.*\.md$/.test(name))
  .sort();

describe("docs routing source contracts", () => {
  test("architecture overview is routed as the current ownership map", () => {
    expect(docsReadme).toContain(
      "Architecture map and ownership boundaries | [`architecture/overview.md`](./architecture/overview.md)",
    );
    expect(rootReadme).toContain(
      "Architecture map and ownership boundaries live in [`docs/architecture/overview.md`](./docs/architecture/overview.md)",
    );
    expect(rootReadme).toContain(
      "架构总图和 ownership 边界见 [`docs/architecture/overview.md`](./docs/architecture/overview.md)",
    );
    expect(handoffDoc).toContain("docs/architecture/overview.md");

    expect(architectureOverviewDoc).toContain("Current Architecture Overview");
    expect(architectureOverviewDoc).toContain("app/api/*");
    expect(architectureOverviewDoc).toContain("lib/api/*");
    expect(architectureOverviewDoc).toContain("lib/types.ts");
    expect(architectureOverviewDoc).toContain("workers/*");
    expect(architectureOverviewDoc).toContain("scripts/ops/run-cron.ts");
    expect(architectureOverviewDoc).toContain("tests/**/*-source.test.ts");
    expect(architectureOverviewDoc).toContain("bun run verify");
    expect(architectureOverviewDoc).not.toContain("Full design");
    expect(architectureOverviewDoc).not.toContain("planned");
  });

  test("root aggregation handoff is clearly archived, not current guidance", () => {
    expect(docsReadme).toContain("[`HANDOFF-AGGREGATION.md`](./HANDOFF-AGGREGATION.md)");
    expect(docsReadme).toContain("Root-level 2026-04-24 aggregation handoff");
    expect(docsReadme).toContain("current clustering behavior lives in [`architecture/ingestion.md`](./architecture/ingestion.md)");

    expect(aggregationHandoff.slice(0, 500)).toContain("Historical archive");
    expect(aggregationHandoff.slice(0, 500)).toContain("not current implementation guidance");
    expect(aggregationHandoff.slice(0, 500)).toContain("docs/architecture/ingestion.md");
  });

  test("aggregation handoff archives self-identify before read-order instructions", () => {
    expect(docsReadme).toContain("[`aggregation/HANDOFF*.md`](./aggregation/)");
    expect(aggregationHandoffFiles.length).toBeGreaterThanOrEqual(7);
    expect(aggregationHandoffFiles).toContain("HANDOFF.md");

    for (const file of aggregationHandoffFiles) {
      const lead = readSource(`docs/aggregation/${file}`).slice(0, 700);
      expect(lead, file).toContain("Historical archive");
      expect(lead, file).toContain("not current implementation guidance");
      expect(lead, file).toContain("../architecture/ingestion.md");
      expect(lead.indexOf("Historical archive"), file).toBeLessThan(
        lead.indexOf("Read order"),
      );
    }
  });

  test("aggregation design and implementation plan are archived before executable guidance", () => {
    expect(docsReadme).toContain("[`aggregation/DESIGN.md`](./aggregation/DESIGN.md)");
    expect(docsReadme).toContain("Original 2026-04-24 event-aggregation design record");
    expect(docsReadme).toContain("[`aggregation/PLAN.md`](./aggregation/PLAN.md)");
    expect(docsReadme).toContain("Do not execute its checklist");

    const designLead = aggregationDesign.slice(0, 700);
    expect(designLead).toContain("Historical archive");
    expect(designLead).toContain("not current implementation guidance");
    expect(designLead).toContain("../architecture/ingestion.md");
    expect(designLead.indexOf("Historical archive")).toBeLessThan(
      designLead.indexOf("**Status:**"),
    );

    const planLead = aggregationPlan.slice(0, 700);
    expect(planLead).toContain("Historical archive");
    expect(planLead).toContain("not current implementation guidance");
    expect(planLead).toContain("Do not execute this checklist");
    expect(planLead).toContain("../architecture/ingestion.md");
    expect(planLead.indexOf("Historical archive")).toBeLessThan(
      planLead.indexOf("For agentic workers"),
    );
  });

  test("daily-column design, plan, and handoff archive themselves before old instructions", () => {
    expect(docsReadme).toContain("[`daily-column/DESIGN.md`](./daily-column/DESIGN.md)");
    expect(docsReadme).toContain("Original 2026-04-25 daily-column structure");
    expect(docsReadme).toContain("[`daily-column/PLAN.md`](./daily-column/PLAN.md)");
    expect(docsReadme).toContain("Do not execute its checklist");
    expect(docsReadme).toContain("[`daily-column/HANDOFF-2026-04-25.md`](./daily-column/HANDOFF-2026-04-25.md)");
    expect(docsReadme).toContain("Historical voice/page iteration notes");

    const designLead = dailyColumnDesign.slice(0, 700);
    expect(designLead).toContain("Historical archive");
    expect(designLead).toContain("not current implementation guidance");
    expect(designLead).toContain("../architecture/ingestion.md");
    expect(designLead).toContain("../../lib/llm/prompts/daily-column.md");
    expect(designLead.indexOf("Historical archive")).toBeLessThan(
      designLead.indexOf("**Status**"),
    );

    const planLead = dailyColumnPlan.slice(0, 700);
    expect(planLead).toContain("Historical archive");
    expect(planLead).toContain("not current implementation guidance");
    expect(planLead).toContain("Do not execute this checklist");
    expect(planLead).toContain("../HANDOFF.md");
    expect(planLead.indexOf("Historical archive")).toBeLessThan(
      planLead.indexOf("For agentic workers"),
    );

    const handoffLead = dailyColumnHandoff.slice(0, 900);
    expect(handoffLead).toContain("Historical archive");
    expect(handoffLead).toContain("not current implementation guidance");
    expect(handoffLead).toContain("../../lib/llm/prompts/daily-column.md");
    expect(handoffLead).toContain("Historical read order");
    expect(handoffLead).toContain("launch-era state + voice journey");
    expect(handoffLead).not.toContain("current state + voice journey");
    expect(handoffLead.indexOf("Historical archive")).toBeLessThan(
      handoffLead.indexOf("Historical read order"),
    );
  });

  test("AI HOT plan is routed as a shipped design record, not the runtime source", () => {
    expect(rootReadme).toContain(
      "Current ingestion architecture, including AI HOT runtime behavior and blueprint deviations, lives in [`docs/architecture/ingestion.md`](./docs/architecture/ingestion.md)",
    );
    expect(rootReadme).toContain(
      "The shipped AI HOT design record is archived at [`docs/aihot-integration/PLAN.md`](./docs/aihot-integration/PLAN.md)",
    );
    expect(rootReadme).toContain(
      "当前 ingestion 架构（含 AI HOT 运行时行为和蓝图偏差）见 [`docs/architecture/ingestion.md`](./docs/architecture/ingestion.md)",
    );
    expect(rootReadme).toContain(
      "已上线的 AI HOT 设计记录归档在 [`docs/aihot-integration/PLAN.md`](./docs/aihot-integration/PLAN.md)",
    );
    expect(rootReadme).not.toContain(
      "AI HOT integration design is in [`docs/aihot-integration/PLAN.md`](./docs/aihot-integration/PLAN.md)",
    );
    expect(rootReadme).not.toContain(
      "AI HOT 集成设计见 [`docs/aihot-integration/PLAN.md`](./docs/aihot-integration/PLAN.md)",
    );

    expect(docsReadme).toContain(
      "cron behavior, AI HOT runtime behavior | [`architecture/ingestion.md`](./architecture/ingestion.md)",
    );
    expect(docsReadme).toContain(
      "[`aihot-integration/PLAN.md`](./aihot-integration/PLAN.md) | Shipped 2026-05-08 AI HOT integration and voice-rebase design record",
    );
    expect(docsReadme).toContain(
      "Current AI HOT runtime behavior lives in [`architecture/ingestion.md`](./architecture/ingestion.md)",
    );
    expect(ingestionDoc).toContain(
      "Historical design record: [`docs/aihot-integration/PLAN.md`](../aihot-integration/PLAN.md); this section is the current runtime summary.",
    );
    expect(ingestionDoc).not.toContain(
      "Full design: `docs/aihot-integration/PLAN.md`",
    );

    const planLead = aihotPlan.slice(0, 700);
    expect(planLead).toContain("Historical archive");
    expect(planLead).toContain("not current implementation guidance");
    expect(planLead).toContain("../architecture/ingestion.md");
    expect(planLead).toContain("**Status**: shipped");
    expect(planLead).toContain("retained as the design record");
    expect(planLead.indexOf("Historical archive")).toBeLessThan(
      planLead.indexOf("**Tier**"),
    );
  });

  test("handoff routes agent API MCP work to current agent-access guidance", () => {
    expect(docsReadme).toContain(
      "Agent/API/MCP surface | [`agent-access/README.md`](./agent-access/README.md)",
    );
    expect(docsReadme).toContain(
      "Historical s9 bearer API/MCP design record. Current agent/API/MCP behavior lives in [`agent-access/README.md`](./agent-access/README.md)",
    );

    expect(handoffDoc).toContain("Historical Session 9 priorities (superseded)");
    expect(handoffDoc).toContain("docs/agent-access/README.md");
    expect(handoffDoc).toContain("docs/AGENT-MCP-PLAN.md");
    expect(handoffDoc).toContain("Do not treat this checklist as current work");
    expect(handoffDoc).not.toContain(
      "Read [`docs/AGENT-MCP-PLAN.md`](./AGENT-MCP-PLAN.md) for the full design",
    );
    expect(handoffDoc).not.toContain(
      "Full design in [`docs/AGENT-MCP-PLAN.md`](./AGENT-MCP-PLAN.md). Phases:",
    );

    const planLead = agentMcpPlan.slice(0, 700);
    expect(planLead).toContain("Historical archive");
    expect(planLead).toContain("not current implementation guidance");
    expect(planLead).toContain("agent-access/README.md");
    expect(planLead).toContain("../lib/types.ts");
    expect(planLead.indexOf("Historical archive")).toBeLessThan(
      planLead.indexOf("Drafted end of session 8"),
    );
  });

  test("session 8 punchlist is archived before old triage instructions", () => {
    expect(docsReadme).toContain("[`SESSION8-PUNCHLIST.md`](./SESSION8-PUNCHLIST.md)");
    expect(docsReadme).toContain("Old punchlist snapshot");
    expect(docsReadme).toContain("use current code, tests, and [`HANDOFF.md`](./HANDOFF.md) instead");

    const punchlistLead = session8Punchlist.slice(0, 700);
    expect(punchlistLead).toContain("Historical archive");
    expect(punchlistLead).toContain("not current implementation guidance");
    expect(punchlistLead).toContain("docs/README.md");
    expect(punchlistLead).toContain("docs/HANDOFF.md");
    expect(punchlistLead.indexOf("Historical archive")).toBeLessThan(
      punchlistLead.indexOf("First thing s8 must do"),
    );
  });

  test("testing guidance is routed through the current docs index", () => {
    expect(docsReadme).toContain(
      "Testing and local verification strategy | [`testing/strategy.md`](./testing/strategy.md)",
    );
    expect(rootReadme).toContain(
      "Testing and local verification strategy lives in [`docs/testing/strategy.md`](./docs/testing/strategy.md)",
    );
    expect(handoffDoc).toContain("docs/testing/strategy.md");

    expect(testingStrategyDoc).toContain("bun run verify");
    expect(testingStrategyDoc).toContain("Targeted Tests");
    expect(testingStrategyDoc).toContain("git diff --check");
    expect(testingStrategyDoc).not.toContain("vitest");
    expect(testingStrategyDoc).not.toContain("npm run");
  });
});
