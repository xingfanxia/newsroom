import { describe, expect, test } from "bun:test";
import {
  deriveActiveSources,
  deriveDayCounts,
  derivePodcastChannels,
  deriveRadarStats,
  deriveSourceCatalog,
  deriveXHandles,
} from "@/lib/public-content/derive";
import {
  getPublicDailyByDate,
  listPublicDailyIndex,
  renderPublicDailyMarkdown,
} from "@/lib/public-content/public-dailies";
import { PARITY_NOW_MS, PARITY_STATE } from "./fixtures/parity-corpus";

describe("pure public artifact derivation", () => {
  test("derives shell and calendar aggregates from eligible lead stories", () => {
    expect(deriveRadarStats(PARITY_STATE, PARITY_NOW_MS)).toEqual({
      items_today: 7,
      items_p1: 2,
      items_featured: 2,
      tracked_sources: 3,
    });
    expect(deriveDayCounts(PARITY_STATE, 5, { tier: "all" }, PARITY_NOW_MS)).toEqual([
      { date: "2026-07-14", count: 3 },
      { date: "2026-07-13", count: 3 },
      { date: "2026-07-12", count: 1 },
      { date: "2026-07-10", count: 1 },
    ]);
    expect(
      deriveDayCounts(PARITY_STATE, 5, { tier: "featured" }, PARITY_NOW_MS),
    ).toEqual([
      { date: "2026-07-14", count: 2 },
      { date: "2026-07-13", count: 2 },
      { date: "2026-07-12", count: 1 },
    ]);
  });

  test("derives podcast, X, active-source and catalog views deterministically", () => {
    expect(derivePodcastChannels(PARITY_STATE)).toEqual([
      { id: "alpha-podcast", nameEn: "Alpha Podcast", nameZh: "阿尔法播客", count: 3 },
    ]);
    expect(deriveXHandles(PARITY_STATE, PARITY_NOW_MS)).toEqual([
      {
        id: "beta-x",
        handle: "@beta_ai",
        nameEn: "Beta Updates",
        nameZh: "贝塔动态",
        last24h: 2,
        total: 2,
      },
    ]);
    expect(deriveActiveSources(PARITY_STATE).map(({ id }) => id)).toEqual([
      "alpha-podcast",
      "beta-x",
      "delta-vendor",
    ]);
    expect(deriveSourceCatalog(PARITY_STATE).map(({ id }) => id)).toEqual([
      "alpha-podcast",
      "delta-vendor",
      "beta-x",
      "gamma-media",
    ]);
  });

  test("recomputes rolling views from an injected clock without rebuilding state", () => {
    const twoDaysLater = Date.parse("2026-07-16T12:00:00.000Z");
    expect(deriveXHandles(PARITY_STATE, twoDaysLater)[0]?.last24h).toBe(0);
    expect(deriveRadarStats(PARITY_STATE, twoDaysLater).items_today).toBe(0);
  });

  test("derives daily index, date lookup and markdown bytes", () => {
    expect(listPublicDailyIndex(PARITY_STATE, { locale: "zh", take: 2 })).toEqual({
      count: 2,
      items: [
        {
          id: 201,
          date: "2026-07-14",
          generated_at: "2026-07-14T11:30:00.000Z",
          title: "今日模型与产品",
          theme_tag: "模型进展",
          story_count: 3,
        },
        {
          id: 202,
          date: "2026-07-13",
          generated_at: "2026-07-13T11:30:00.000Z",
          title: "昨日回顾",
          theme_tag: "行业动态",
          story_count: 2,
        },
      ],
    });
    const daily = getPublicDailyByDate(PARITY_STATE, "2026-07-14", "zh");
    expect(daily).toMatchObject({ id: 201, title: "今日模型与产品" });
    expect(renderPublicDailyMarkdown(daily!)).toBe(
      "# AX 的 AI 日报 · 2026-07-14\n\n## 今日模型与产品\n\n_# 模型进展_\n\n今日摘要\n\n---\n\n今日正文",
    );
  });
});
