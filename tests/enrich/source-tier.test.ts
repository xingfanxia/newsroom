import { describe, expect, it } from "bun:test";
import { applyNeverExcludeTierFloor } from "@/workers/enrich/source-tier";
import { readSource } from "@/tests/helpers/source";

describe("enrich source tier policy", () => {
  it("floors excluded verdicts for every never_exclude source id", () => {
    const neverExcludeSourceIds = new Set(["ai-chatgroup-daily"]);

    expect(
      applyNeverExcludeTierFloor({
        sourceId: "ai-chatgroup-daily",
        tier: "excluded",
        neverExcludeSourceIds,
      }),
    ).toBe("all");
    expect(
      applyNeverExcludeTierFloor({
        sourceId: "ai-chatgroup-daily",
        tier: "featured",
        neverExcludeSourceIds,
      }),
    ).toBe("featured");
    expect(
      applyNeverExcludeTierFloor({
        sourceId: "ordinary-source",
        tier: "excluded",
        neverExcludeSourceIds,
      }),
    ).toBe("excluded");
  });

  it("keeps live enrich and score backfill on the shared source policy", () => {
    const liveWorker = readSource("workers/enrich/index.ts");
    const scoreBackfill = readSource("workers/enrich/score-backfill.ts");
    const sourceTier = readSource("workers/enrich/source-tier.ts");

    expect(sourceTier).toContain("loadNeverExcludeSourceIds");
    expect(sourceTier).toContain("applyNeverExcludeTierFloor");
    expect(sourceTier).toContain("sources.neverExclude");

    for (const source of [liveWorker, scoreBackfill]) {
      expect(source).toContain("loadNeverExcludeSourceIds");
      expect(source).toContain("applyNeverExcludeTierFloor");
      expect(source).not.toContain('endsWith("-yt")');
      expect(source).not.toContain("source_id LIKE '%-yt'");
    }
  });
});
