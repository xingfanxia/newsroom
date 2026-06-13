import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  formatQueryIssues,
  invalidQueryError,
  parseQueryParams,
  queryParamsRecord,
} from "@/lib/api/query-params";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(5),
  mode: z.enum(["fast", "deep"]).default("fast"),
});

describe("query param helpers", () => {
  test("extracts URLSearchParams from Request and URL sources", () => {
    expect(
      queryParamsRecord(new Request("https://example.test/api?limit=3")),
    ).toEqual({ limit: "3" });
    expect(queryParamsRecord(new URL("https://example.test/api?mode=deep"))).toEqual({
      mode: "deep",
    });
  });

  test("parses query schemas from request-like and raw record sources", () => {
    expect(
      parseQueryParams(
        new Request("https://example.test/api?limit=3&mode=deep"),
        querySchema,
      ),
    ).toEqual({
      ok: true,
      data: { limit: 3, mode: "deep" },
    });

    expect(parseQueryParams({ limit: "2" }, querySchema)).toEqual({
      ok: true,
      data: { limit: 2, mode: "fast" },
    });
  });

  test("returns Zod issues without choosing a response envelope", () => {
    const parsed = parseQueryParams({ limit: "99" }, querySchema);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(formatQueryIssues(parsed.issues)).toBe(
        "Too big: expected number to be <=10",
      );
      expect(invalidQueryError(parsed.issues)).toBe(
        "invalid_query: Too big: expected number to be <=10",
      );
    }
  });
});
