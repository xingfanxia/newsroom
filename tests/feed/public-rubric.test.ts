import { describe, expect, test } from "bun:test";
import { publicStoryFromItem, createPublicStateIndex } from "@/lib/public-content/public-items";
import { PARITY_NOW_MS, PARITY_STATE } from "../public-content/fixtures/parity-corpus";

describe("public feed rubric", () => {
  test("renders public-safe rubric copy without a reasoning payload field", () => {
    const index = createPublicStateIndex(PARITY_STATE);
    const story = publicStoryFromItem(index, index.itemsById.get(1)!, {
      locale: "en",
      nowMs: PARITY_NOW_MS,
    });
    expect(story.whyFeatured).toBe(
      "Featured · importance 95 · hook + knowledge",
    );
    expect(story).not.toHaveProperty("reasoning");
    expect(JSON.stringify(story)).not.toContain("reasoning");
  });
});
