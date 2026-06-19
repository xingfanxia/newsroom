import { describe, expect, test } from "bun:test";
import {
  coerceSourcesView,
  DEFAULT_SOURCES_VIEW,
  SOURCES_VIEWS,
} from "@/lib/sources/view";

describe("sources view contract", () => {
  test("keeps table as the default source catalog view", () => {
    expect(SOURCES_VIEWS).toEqual(["table", "cards"]);
    expect(DEFAULT_SOURCES_VIEW).toBe("table");
  });

  test("coerces unknown route params to the default", () => {
    expect(coerceSourcesView("cards")).toBe("cards");
    expect(coerceSourcesView("table")).toBe("table");
    expect(coerceSourcesView("grid")).toBe(DEFAULT_SOURCES_VIEW);
    expect(coerceSourcesView(undefined)).toBe(DEFAULT_SOURCES_VIEW);
  });
});
