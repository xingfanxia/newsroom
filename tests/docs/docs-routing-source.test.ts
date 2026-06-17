import { describe, expect, test } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const rootReadme = readSource("README.md");
const docsReadme = readSource("docs/README.md");
const ingestionDoc = readSource("docs/architecture/ingestion.md");
const aggregationHandoff = readSource("docs/HANDOFF-AGGREGATION.md");
const aihotPlan = readSource("docs/aihot-integration/PLAN.md");

describe("docs routing source contracts", () => {
  test("root aggregation handoff is clearly archived, not current guidance", () => {
    expect(docsReadme).toContain("[`HANDOFF-AGGREGATION.md`](./HANDOFF-AGGREGATION.md)");
    expect(docsReadme).toContain("Root-level 2026-04-24 aggregation handoff");
    expect(docsReadme).toContain("current clustering behavior lives in [`architecture/ingestion.md`](./architecture/ingestion.md)");

    expect(aggregationHandoff.slice(0, 500)).toContain("Historical archive");
    expect(aggregationHandoff.slice(0, 500)).toContain("not current implementation guidance");
    expect(aggregationHandoff.slice(0, 500)).toContain("docs/architecture/ingestion.md");
  });

  test("AI HOT plan is routed as a shipped design record, not the runtime source", () => {
    expect(rootReadme).toContain(
      "Current architecture, including AI HOT runtime behavior and blueprint deviations, lives in [`docs/architecture/ingestion.md`](./docs/architecture/ingestion.md)",
    );
    expect(rootReadme).toContain(
      "The shipped AI HOT design record is archived at [`docs/aihot-integration/PLAN.md`](./docs/aihot-integration/PLAN.md)",
    );
    expect(rootReadme).toContain(
      "当前架构（含 AI HOT 运行时行为和蓝图偏差）见 [`docs/architecture/ingestion.md`](./docs/architecture/ingestion.md)",
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

    expect(aihotPlan.slice(0, 500)).toContain("**Status**: shipped");
    expect(aihotPlan.slice(0, 500)).toContain("retained as the design record");
    expect(aihotPlan.slice(0, 500)).toContain("current runtime behavior is");
  });
});
