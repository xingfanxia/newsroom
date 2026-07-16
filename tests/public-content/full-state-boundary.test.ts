import { describe, expect, test } from "bun:test";
import { checkPublicFullStateBoundary } from "@/scripts/ops/check-public-full-state-boundary";

describe("anonymous public full-state boundary", () => {
  test("keeps aggregate canonical reads behind release-capability fallbacks", () => {
    expect(checkPublicFullStateBoundary(process.cwd())).toEqual({
      ok: true,
      violations: [],
    });
  });
});
