import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

describe("tweaks route payload source contract", () => {
  test("types the shared payload as a partial Tweaks contract", () => {
    const source = read("lib/api/tweak-routes.ts");

    expect(source).toContain('from "@/lib/tweaks"');
    expect(source).toContain("tweaks: Partial<Tweaks> | null;");
    expect(source).not.toContain("tweaks: unknown | null;");
  });
});
