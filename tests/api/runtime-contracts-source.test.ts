import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const types = read("lib/types.ts");
const schema = read("db/schema.ts");
const feedParams = read("lib/api/feed-query-params.ts");
const eventMembers = read("lib/api/event-members.ts");
const dailyColumns = read("lib/api/daily-columns.ts");
const feedbackToggle = read("lib/feedback/toggle.ts");
const feedbackMetrics = read("lib/feedback/metrics.ts");
const savedCollections = read("lib/items/collections.ts");
const savedItems = read("lib/items/saved.ts");
const mcpRoute = read("app/api/mcp/route.ts");
const v1SavedRoute = read("app/api/v1/saved/route.ts");
const sitemap = read("app/sitemap.ts");
const liveItems = read("lib/items/live.ts");
const itemDetail = read("lib/items/detail.ts");
const fetcher = read("workers/fetcher/index.ts");

describe("runtime contract source wiring", () => {
  test("locales have shared runtime tuples for app routes and source rows", () => {
    expect(types).toContain("export const APP_LOCALES");
    expect(types).toContain("export const SOURCE_LOCALES");
    expect(schema).toContain('pgEnum("locale_kind", SOURCE_LOCALES)');

    for (const source of [
      feedParams,
      eventMembers,
      dailyColumns,
      mcpRoute,
      v1SavedRoute,
      sitemap,
    ]) {
      expect(source).toContain("APP_LOCALES");
    }

    expect(liveItems).toContain("type Locale = AppLocale");
    expect(itemDetail).toContain("type Locale = AppLocale");
  });

  test("fetcher support is a named subset of source kind tuples", () => {
    expect(types).toContain("export const FETCHABLE_SOURCE_KINDS");
    expect(fetcher).toContain("FETCHABLE_SOURCE_KINDS");
    expect(fetcher).not.toContain("const SUPPORTED_KINDS");
    expect(fetcher).not.toContain(
      '["rss", "atom", "rsshub", "x-api", "aihot-api"] as const',
    );
  });

  test("feedback vote values have one runtime source of truth", () => {
    expect(types).toContain("export const FEEDBACK_VOTES");
    expect(types).toContain("export const FEEDBACK_SIGNAL_VOTES");
    expect(types).toContain("export const FEEDBACK_SAVE_VOTE");
    expect(schema).toContain('pgEnum("feedback_vote", FEEDBACK_VOTES)');
    expect(feedbackToggle).toContain("z.enum(FEEDBACK_VOTES)");
    expect(feedbackMetrics).toContain("FEEDBACK_SIGNAL_VOTES");
    expect(feedbackMetrics).toContain("FeedbackVote");

    for (const source of [savedCollections, savedItems]) {
      expect(source).toContain("FEEDBACK_SAVE_VOTE");
      expect(source).not.toContain('eq(feedback.vote, "save")');
      expect(source).not.toContain("${feedback.vote} = 'save'");
    }

    for (const source of [schema, feedbackToggle, feedbackMetrics]) {
      expect(source).not.toContain('["up", "down", "save"]');
      expect(source).not.toContain('["up", "down"]');
      expect(source).not.toContain('"up" | "down" | "save"');
    }
  });
});
