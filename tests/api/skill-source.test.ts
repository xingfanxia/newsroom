import { describe, expect, test } from "bun:test";
import { GET as getSkillMarkdown } from "@/app/skill.md/route";
import {
  APP_LOCALES,
  FEED_VIEWS,
  ITEM_TIERS,
  SEARCH_MODES,
  SOURCE_GROUPS,
  SOURCE_KINDS,
  VISIBLE_ITEM_TIERS,
} from "@/lib/types";
import { readSource } from "@/tests/helpers/source";

const skillRoute = readSource("app/skill.md/route.ts");

function markdownCodeUnion(values: readonly string[]): string {
  return values.map((value) => `\`${value}\``).join(" | ");
}

function compactUnion(values: readonly (string | null)[]): string {
  return values.map((value) => (value === null ? "null" : value)).join("|");
}

describe("public skill contract source wiring", () => {
  test("route derives agent-visible contract enums from runtime tuples", () => {
    expect(skillRoute).toContain("@/lib/types");
    for (const tupleName of [
      "APP_LOCALES",
      "FEED_VIEWS",
      "ITEM_TIERS",
      "SEARCH_MODES",
      "SOURCE_GROUPS",
      "SOURCE_KINDS",
      "VISIBLE_ITEM_TIERS",
    ]) {
      expect(skillRoute).toContain(tupleName);
    }

    for (const duplicatedContract of [
      String.raw`- \`tier\` = \`featured\` (default) | \`p1\` | \`all\``,
      String.raw`- \`view\` = \`today\` | \`archive\` (default)`,
      String.raw`- \`locale\` = zh | en, default en`,
      String.raw`"source_group": "podcast|newsletter|...|null"`,
      String.raw`"tier": "featured|p1|all|excluded"`,
    ]) {
      expect(skillRoute).not.toContain(duplicatedContract);
    }
  });

  test("served markdown expands shared runtime tuples for installing agents", async () => {
    const response = await getSkillMarkdown();
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(text).toContain(
      `- \`tier\` = ${markdownCodeUnion(VISIBLE_ITEM_TIERS)}, default \`featured\``,
    );
    expect(text).toContain(
      `- \`view\` = ${markdownCodeUnion(FEED_VIEWS)}, default \`archive\``,
    );
    expect(text).toContain(
      `- \`source_group\` = ${markdownCodeUnion(SOURCE_GROUPS)}`,
    );
    expect(text).toContain(
      `- \`source_kind\` = ${markdownCodeUnion(SOURCE_KINDS)}`,
    );
    expect(text).toContain(
      `- \`mode\` = ${markdownCodeUnion(SEARCH_MODES)}, default \`lexical\``,
    );
    expect(text).toContain(
      `- \`locale\` = ${markdownCodeUnion(APP_LOCALES)}, default \`en\``,
    );
    expect(text).toContain(
      `"source_group": "${compactUnion([...SOURCE_GROUPS, null])}"`,
    );
    expect(text).toContain(`"source_kind": "${compactUnion(SOURCE_KINDS)}"`);
    expect(text).toContain(`"tier": "${compactUnion(ITEM_TIERS)}"`);
  });
});
