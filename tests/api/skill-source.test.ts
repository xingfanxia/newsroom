import { describe, expect, test } from "bun:test";
import { GET as getSkillMarkdown } from "@/app/skill.md/route";
import {
  DAILY_COLUMN_INDEX_TAKE_MAX,
  DAILY_COLUMN_INDEX_TAKE_MIN,
  DEFAULT_DAILY_COLUMN_INDEX_TAKE,
} from "@/lib/daily-column/query-defaults";
import { DAILY_COLUMN_INDEX_ROUTE } from "@/lib/daily-column/routes";
import {
  DEFAULT_API_FEED_LOCALE,
  DEFAULT_FEED_HOT_WINDOW_HOURS,
  DEFAULT_FEED_LIMIT,
  DEFAULT_FEED_OFFSET,
  DEFAULT_FEED_TIER,
  DEFAULT_FEED_VIEW,
  FEED_HOT_WINDOW_HOURS_MAX,
  FEED_HOT_WINDOW_HOURS_MIN,
  FEED_LIMIT_MIN,
  PUBLIC_FEED_LIMIT_MAX,
} from "@/lib/feed/query-defaults";
import {
  DEFAULT_API_SEARCH_LOCALE,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SEARCH_MODE,
  DEFAULT_SEARCH_OFFSET,
  PUBLIC_SEARCH_LIMIT_MAX,
  SEARCH_LIMIT_MIN,
} from "@/lib/search/query-defaults";
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
    expect(skillRoute).toContain("DAILY_COLUMN_INDEX_ROUTE");
    expect(skillRoute).not.toContain('publicUrl("/zh/daily")');
    expect(skillRoute).toContain("@/lib/feed/query-defaults");
    expect(skillRoute).toContain("@/lib/search/query-defaults");

    for (const defaultName of [
      "DEFAULT_FEED_TIER",
      "DEFAULT_FEED_VIEW",
      "DEFAULT_FEED_HOT_WINDOW_HOURS",
      "DEFAULT_FEED_LIMIT",
      "DEFAULT_FEED_OFFSET",
      "DEFAULT_API_FEED_LOCALE",
      "PUBLIC_FEED_LIMIT_MAX",
      "DEFAULT_SEARCH_MODE",
      "DEFAULT_SEARCH_LIMIT",
      "DEFAULT_SEARCH_OFFSET",
      "DEFAULT_API_SEARCH_LOCALE",
      "PUBLIC_SEARCH_LIMIT_MAX",
    ]) {
      expect(skillRoute).toContain(defaultName);
    }

    for (const duplicatedContract of [
      String.raw`- \`tier\` = \`featured\` (default) | \`p1\` | \`all\``,
      String.raw`- \`view\` = \`today\` | \`archive\` (default)`,
      String.raw`- \`locale\` = zh | en, default en`,
      String.raw`limit ≤ 100, default 40`,
      String.raw`- \`hot_window_hours\` = 1..168, default 24`,
      String.raw`- \`limit\` = 1..100, default 40`,
      String.raw`default \`lexical\``,
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
      `- \`tier\` = ${markdownCodeUnion(VISIBLE_ITEM_TIERS)}, default \`${DEFAULT_FEED_TIER}\``,
    );
    expect(text).toContain(
      `- \`view\` = ${markdownCodeUnion(FEED_VIEWS)}, default \`${DEFAULT_FEED_VIEW}\``,
    );
    expect(text).toContain(
      `- \`hot_window_hours\` = ${FEED_HOT_WINDOW_HOURS_MIN}..${FEED_HOT_WINDOW_HOURS_MAX}, default ${DEFAULT_FEED_HOT_WINDOW_HOURS}`,
    );
    expect(text).toContain(
      `- \`source_group\` = ${markdownCodeUnion(SOURCE_GROUPS)}`,
    );
    expect(text).toContain(
      `- \`source_kind\` = ${markdownCodeUnion(SOURCE_KINDS)}`,
    );
    expect(text).toContain(
      `- \`limit\` = ${FEED_LIMIT_MIN}..${PUBLIC_FEED_LIMIT_MAX}, default ${DEFAULT_FEED_LIMIT}`,
    );
    expect(text).toContain(
      `- \`offset\` = ≥0, default ${DEFAULT_FEED_OFFSET}`,
    );
    expect(text).toContain(
      `- \`locale\` = ${markdownCodeUnion(APP_LOCALES)}, default \`${DEFAULT_API_FEED_LOCALE}\``,
    );
    expect(text).toContain(
      `/api/public/feed: \`limit\` ${FEED_LIMIT_MIN}..${PUBLIC_FEED_LIMIT_MAX}, default ${DEFAULT_FEED_LIMIT}; \`offset\` default ${DEFAULT_FEED_OFFSET}.`,
    );
    expect(text).toContain(
      `/api/public/search: \`limit\` ${SEARCH_LIMIT_MIN}..${PUBLIC_SEARCH_LIMIT_MAX}, default ${DEFAULT_SEARCH_LIMIT}; \`offset\` default ${DEFAULT_SEARCH_OFFSET}.`,
    );
    expect(text).toContain(
      `/api/public/dailies: \`take\` ${DAILY_COLUMN_INDEX_TAKE_MIN}..${DAILY_COLUMN_INDEX_TAKE_MAX}, default ${DEFAULT_DAILY_COLUMN_INDEX_TAKE}.`,
    );
    expect(text).toContain(
      `- \`mode\` = ${markdownCodeUnion(SEARCH_MODES)}, default \`${DEFAULT_SEARCH_MODE}\``,
    );
    expect(text).toContain(
      `- \`limit\` = ${SEARCH_LIMIT_MIN}..${PUBLIC_SEARCH_LIMIT_MAX}, default ${DEFAULT_SEARCH_LIMIT}`,
    );
    expect(text).toContain(
      `- \`offset\` = ≥0, default ${DEFAULT_SEARCH_OFFSET}`,
    );
    expect(text).toContain(
      `- \`locale\` = ${markdownCodeUnion(APP_LOCALES)}, default \`${DEFAULT_API_SEARCH_LOCALE}\``,
    );
    expect(text).toContain(
      `想看完整长篇日报: https://news.ax0x.ai${DAILY_COLUMN_INDEX_ROUTE}`,
    );
    expect(text).toContain(
      `"source_group": "${compactUnion([...SOURCE_GROUPS, null])}"`,
    );
    expect(text).toContain(`"source_kind": "${compactUnion(SOURCE_KINDS)}"`);
    expect(text).toContain(`"tier": "${compactUnion(ITEM_TIERS)}"`);
  });
});
