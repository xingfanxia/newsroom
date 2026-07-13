/**
 * Source-contract tests for the canonical-title no_content wiring (W5.3).
 *
 * The structural `clusters.no_content` flag is stamped here — the LLM decides
 * it, the schema validates it, and the update persists it. merge.ts then treats
 * it as the primary skip signal (see merge.test.ts). These asserts lock the
 * full stamp path so a future edit can't quietly drop the flag and leave merge
 * back on the brittle LIKE-list heuristic.
 */
import { describe, expect, it } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const titleSrc = readSource("workers/cluster/canonical-title.ts");
const promptSrc = readSource("workers/cluster/prompt.ts");

describe("canonical-title no_content stamping (W5.3)", () => {
  it("validates no_content in the structured-output schema", () => {
    expect(titleSrc).toContain("noContent: z.boolean()");
  });

  it("persists the validated no_content flag on the cluster row", () => {
    expect(titleSrc).toContain("noContent: result.data.noContent");
  });

  it("instructs the model to emit no_content and defines it structurally", () => {
    expect(promptSrc).toContain("no_content");
    // It's a dedup signal, not a title-quality judgment — the prompt must say so
    // or the model will over-flag thin-but-real events.
    expect(promptSrc).toContain("noContent: boolean");
  });
});
