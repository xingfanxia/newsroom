import { describe, expect, it } from "bun:test";
import { feedbackBodySchema } from "@/lib/feedback/toggle";

describe("feedbackBodySchema", () => {
  it("accepts a valid up/on payload", () => {
    expect(
      feedbackBodySchema.safeParse({ itemId: 1, vote: "up", on: true })
        .success,
    ).toBe(true);
  });

  it("rejects unknown vote values", () => {
    expect(
      feedbackBodySchema.safeParse({ itemId: 1, vote: "love", on: true })
        .success,
    ).toBe(false);
  });

  it("rejects non-integer and non-positive item ids", () => {
    for (const itemId of [1.5, 0, -1]) {
      expect(
        feedbackBodySchema.safeParse({ itemId, vote: "up", on: true }).success,
      ).toBe(false);
    }
  });

  it("rejects notes above 500 characters", () => {
    expect(
      feedbackBodySchema.safeParse({
        itemId: 1,
        vote: "down",
        on: true,
        note: "x".repeat(501),
      }).success,
    ).toBe(false);
  });
});
