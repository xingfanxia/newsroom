import { describe, expect, test } from "bun:test";
import { policyCommitBodySchema } from "@/lib/api/policy-commit";

describe("policy commit request schema", () => {
  test("accepts a direct admin policy commit body", () => {
    expect(
      policyCommitBodySchema.parse({
        skillName: "editorial",
        content: "Updated policy content",
        reasoning: "manual correction",
      }),
    ).toEqual({
      skillName: "editorial",
      content: "Updated policy content",
      reasoning: "manual correction",
    });
  });

  test("rejects empty names/content and overlong reasoning", () => {
    expect(
      policyCommitBodySchema.safeParse({
        skillName: "",
        content: "Updated policy content",
      }).success,
    ).toBe(false);
    expect(
      policyCommitBodySchema.safeParse({
        skillName: "editorial",
        content: "",
      }).success,
    ).toBe(false);
    expect(
      policyCommitBodySchema.safeParse({
        skillName: "editorial",
        content: "Updated policy content",
        reasoning: "x".repeat(2_001),
      }).success,
    ).toBe(false);
  });
});
