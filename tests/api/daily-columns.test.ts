import { describe, expect, test } from "bun:test";
import {
  dailyColumnDateSchema,
  dailyColumnDateKey,
  dailyColumnDayWindow,
  getDailyColumnMarkdownByDate,
  getLatestPublicDailyColumn,
  getPublicDailyColumnByDate,
  getPublicDailyColumnIndex,
  publicDailyColumnEtagSignal,
  publicDailyColumnIndexEtagSignal,
  renderDailyColumnMarkdown,
  toPublicDailyColumn,
  toPublicDailyColumnIndex,
  toPublicDailyColumnIndexPayload,
  toPublicDailyColumnPayload,
  type DailyColumnIndexRow,
  type DailyColumnRow,
} from "@/lib/api/daily-columns";

const periodStart = new Date("2026-06-11T05:00:00.000Z");
const periodEnd = new Date("2026-06-12T05:00:00.000Z");
const publishedAt = new Date("2026-06-12T05:01:00.000Z");

function dailyRow(overrides: Partial<DailyColumnRow> = {}): DailyColumnRow {
  return {
    id: 216,
    locale: "zh",
    columnTitle: "今天 AI 圈在拼合同，不是模型",
    columnThemeTag: "合同日",
    columnSummaryMd: "1. 第一件事 [#42]",
    columnNarrativeMd: "长文正文",
    columnFeaturedItemIds: [42, 43],
    itemIds: [42, 43, 44],
    storyCount: 20,
    periodStart,
    periodEnd,
    publishedAt,
    ...overrides,
  } as DailyColumnRow;
}

function indexRow(overrides: Partial<DailyColumnIndexRow> = {}): DailyColumnIndexRow {
  return {
    id: 216,
    columnTitle: "今天 AI 圈在拼合同，不是模型",
    columnThemeTag: "合同日",
    storyCount: 20,
    periodStart,
    publishedAt,
    ...overrides,
  } as DailyColumnIndexRow;
}

describe("daily column public API serialization", () => {
  test("serializes the full daily column contract", () => {
    expect(toPublicDailyColumn(dailyRow())).toEqual({
      id: 216,
      locale: "zh",
      date: "2026-06-11",
      generated_at: "2026-06-12T05:01:00.000Z",
      window_start: "2026-06-11T05:00:00.000Z",
      window_end: "2026-06-12T05:00:00.000Z",
      title: "今天 AI 圈在拼合同，不是模型",
      theme_tag: "合同日",
      summary_md: "1. 第一件事 [#42]",
      narrative_md: "长文正文",
      featured_item_ids: [42, 43],
      item_ids: [42, 43, 44],
      story_count: 20,
    });
  });

  test("normalizes nullable id arrays to empty arrays", () => {
    const item = toPublicDailyColumn(
      dailyRow({ columnFeaturedItemIds: null, itemIds: null }),
    );

    expect(item.featured_item_ids).toEqual([]);
    expect(item.item_ids).toEqual([]);
  });

  test("serializes the metadata-only dailies index", () => {
    expect(
      toPublicDailyColumnIndex([
        indexRow(),
        indexRow({
          id: 215,
          periodStart: new Date("2026-06-10T05:00:00.000Z"),
        }),
      ]),
    ).toEqual({
      count: 2,
      items: [
        {
          id: 216,
          date: "2026-06-11",
          generated_at: "2026-06-12T05:01:00.000Z",
          title: "今天 AI 圈在拼合同，不是模型",
          theme_tag: "合同日",
          story_count: 20,
        },
        {
          id: 215,
          date: "2026-06-10",
          generated_at: "2026-06-12T05:01:00.000Z",
          title: "今天 AI 圈在拼合同，不是模型",
          theme_tag: "合同日",
          story_count: 20,
        },
      ],
    });
  });

  test("builds stable ETag signals for full and index responses", () => {
    expect(publicDailyColumnEtagSignal(dailyRow())).toBe(
      "id=216|generated=2026-06-12T05:01:00.000Z",
    );
    expect(
      publicDailyColumnIndexEtagSignal([indexRow()], {
        locale: "zh",
        take: 30,
      }),
    ).toBe(
      "count=1|first_id=216|first_gen=2026-06-12T05:01:00.000Z|locale=zh|take=30",
    );
  });

  test("builds route-ready public payloads with body and ETag signal", () => {
    expect(toPublicDailyColumnPayload(dailyRow())).toEqual({
      body: toPublicDailyColumn(dailyRow()),
      etagSignal: "id=216|generated=2026-06-12T05:01:00.000Z",
    });

    expect(
      toPublicDailyColumnIndexPayload([indexRow()], {
        locale: "zh",
        take: 30,
      }),
    ).toEqual({
      body: toPublicDailyColumnIndex([indexRow()]),
      etagSignal:
        "count=1|first_id=216|first_gen=2026-06-12T05:01:00.000Z|locale=zh|take=30",
    });
  });
});

describe("daily column shared date helpers", () => {
  test("accepts only real UTC calendar dates", () => {
    expect(dailyColumnDateSchema.safeParse("2026-06-11").success).toBe(true);
    expect(dailyColumnDateSchema.safeParse("2026-99-99").success).toBe(false);
    expect(dailyColumnDateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(dailyColumnDateSchema.safeParse("06-11-2026").success).toBe(false);
  });

  test("uses the UTC period_start date as the public date key", () => {
    expect(dailyColumnDateKey(periodStart)).toBe("2026-06-11");
  });

  test("builds the UTC day window used by route and MCP lookups", () => {
    expect(dailyColumnDayWindow("2026-06-11")).toEqual({
      start: new Date("2026-06-11T00:00:00.000Z"),
      end: new Date("2026-06-12T00:00:00.000Z"),
    });
  });

  test("renders the MCP markdown resource from the same row contract", () => {
    expect(renderDailyColumnMarkdown(dailyRow())).toBe(
      [
        "# AX 的 AI 日报 · 2026-06-11",
        "",
        "## 今天 AI 圈在拼合同，不是模型",
        "",
        "_# 合同日_",
        "",
        "1. 第一件事 [#42]",
        "",
        "---",
        "",
        "长文正文",
      ].join("\n"),
    );
  });

  test("public route helpers return validation errors before lookup", async () => {
    await expect(getLatestPublicDailyColumn("ja")).resolves.toEqual({
      ok: false,
      error: "invalid_locale",
      status: 400,
    });

    await expect(
      getPublicDailyColumnByDate({
        rawDate: "2026-02-30",
        rawLocale: "zh",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_date", status: 400 });

    await expect(
      getPublicDailyColumnByDate({
        rawDate: "2026-06-11",
        rawLocale: "ja",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_locale", status: 400 });

    await expect(getPublicDailyColumnIndex({ take: "0" })).resolves.toEqual({
      ok: false,
      error:
        "invalid_query: Too small: expected number to be >=1",
      status: 400,
    });
  });

  test("MCP markdown helper returns validation text before lookup", async () => {
    await expect(
      getDailyColumnMarkdownByDate("2026-99-99", "zh"),
    ).resolves.toBe("_invalid date format — expected YYYY-MM-DD_");
  });
});
