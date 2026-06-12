import { describe, expect, test } from "bun:test";
import {
  toMcpSourceApiItem,
  toPublicSourceApiItem,
  toV1SourceApiItem,
  type SourceCatalogRow,
} from "@/lib/api/source-catalog";

const row: SourceCatalogRow = {
  id: "openai-news",
  nameEn: "OpenAI News",
  nameZh: "OpenAI News ZH",
  url: "https://openai.com/news/rss.xml",
  kind: "rss",
  group: "vendor-official",
  locale: "en",
  cadence: "hourly",
  priority: 1,
  tags: ["vendor", "frontier-lab"],
  enabled: true,
  curated: true,
  notes: "official blog",
  status: "warning",
  lastFetchedAt: new Date("2026-06-12T01:00:00.000Z"),
  lastSuccessAt: new Date("2026-06-12T00:55:00.000Z"),
  consecutiveFailures: 2,
  lastItemsCount: 3,
  totalItemsCount: 987,
  lastError: "temporary timeout",
};

describe("source catalog API serialization", () => {
  test("serializes the full bearer-gated v1 source contract", () => {
    expect(toV1SourceApiItem(row)).toEqual({
      id: "openai-news",
      name_en: "OpenAI News",
      name_zh: "OpenAI News ZH",
      url: "https://openai.com/news/rss.xml",
      kind: "rss",
      group: "vendor-official",
      locale: "en",
      cadence: "hourly",
      priority: 1,
      tags: ["vendor", "frontier-lab"],
      enabled: true,
      notes: "official blog",
      health: {
        status: "warning",
        last_fetched_at: "2026-06-12T01:00:00.000Z",
        last_success_at: "2026-06-12T00:55:00.000Z",
        consecutive_failures: 2,
        last_items_count: 3,
        total_items_count: 987,
        last_error: "temporary timeout",
      },
    });
  });

  test("serializes the public source contract without operational diagnostics", () => {
    const item = toPublicSourceApiItem(row);

    expect(item).toEqual({
      id: "openai-news",
      name_en: "OpenAI News",
      name_zh: "OpenAI News ZH",
      url: "https://openai.com/news/rss.xml",
      kind: "rss",
      group: "vendor-official",
      locale: "en",
      cadence: "hourly",
      priority: 1,
      tags: ["vendor", "frontier-lab"],
      enabled: true,
      curated: true,
      health: {
        status: "warning",
        last_success_at: "2026-06-12T00:55:00.000Z",
        consecutive_failures: 2,
        total_items_count: 987,
      },
    });
    expect(item.health).not.toHaveProperty("last_error");
    expect(item.health).not.toHaveProperty("last_fetched_at");
  });

  test("serializes the compact MCP source contract", () => {
    expect(toMcpSourceApiItem(row)).toEqual({
      id: "openai-news",
      name_en: "OpenAI News",
      name_zh: "OpenAI News ZH",
      kind: "rss",
      group: "vendor-official",
      cadence: "hourly",
      enabled: true,
      status: "warning",
      last_success_at: "2026-06-12T00:55:00.000Z",
      consecutive_failures: 2,
      total_items: 987,
    });
  });

  test("normalizes missing health rows to pending/zero defaults", () => {
    expect(
      toPublicSourceApiItem({
        ...row,
        status: null,
        lastFetchedAt: null,
        lastSuccessAt: null,
        consecutiveFailures: null,
        lastItemsCount: null,
        totalItemsCount: null,
        lastError: null,
      }),
    ).toMatchObject({
      health: {
        status: "pending",
        last_success_at: null,
        consecutive_failures: 0,
        total_items_count: 0,
      },
    });
  });
});
