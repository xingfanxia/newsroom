import { describe, expect, test } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const docsReadme = readSource("docs/README.md");
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
    expect(docsReadme).toContain(
      "cron behavior, AI HOT runtime behavior | [`architecture/ingestion.md`](./architecture/ingestion.md)",
    );
    expect(docsReadme).toContain(
      "[`aihot-integration/PLAN.md`](./aihot-integration/PLAN.md) | Shipped 2026-05-08 AI HOT integration and voice-rebase design record",
    );
    expect(docsReadme).toContain(
      "Current AI HOT runtime behavior lives in [`architecture/ingestion.md`](./architecture/ingestion.md)",
    );

    expect(aihotPlan.slice(0, 500)).toContain("**Status**: shipped");
    expect(aihotPlan.slice(0, 500)).toContain("retained as the design record");
    expect(aihotPlan.slice(0, 500)).toContain("current runtime behavior is");
  });
});
