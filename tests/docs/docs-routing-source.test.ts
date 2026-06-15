import { describe, expect, test } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const docsReadme = readSource("docs/README.md");
const aggregationHandoff = readSource("docs/HANDOFF-AGGREGATION.md");

describe("docs routing source contracts", () => {
  test("root aggregation handoff is clearly archived, not current guidance", () => {
    expect(docsReadme).toContain("[`HANDOFF-AGGREGATION.md`](./HANDOFF-AGGREGATION.md)");
    expect(docsReadme).toContain("Root-level 2026-04-24 aggregation handoff");
    expect(docsReadme).toContain("current clustering behavior lives in [`architecture/ingestion.md`](./architecture/ingestion.md)");

    expect(aggregationHandoff.slice(0, 500)).toContain("Historical archive");
    expect(aggregationHandoff.slice(0, 500)).toContain("not current implementation guidance");
    expect(aggregationHandoff.slice(0, 500)).toContain("docs/architecture/ingestion.md");
  });
});
