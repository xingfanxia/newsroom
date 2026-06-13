import { describe, expect, test } from "bun:test";
import { pickLocalizedText, pickSameLocaleText } from "@/lib/items/localized";

describe("localized item text helpers", () => {
  test("picks current-locale text before the opposite locale", () => {
    expect(
      pickLocalizedText("en", { en: "English", zh: "中文", fallback: "raw" }),
    ).toBe("English");
    expect(
      pickLocalizedText("zh", { en: "English", zh: "中文", fallback: "raw" }),
    ).toBe("中文");
  });

  test("falls back to the opposite locale, then legacy/raw text", () => {
    expect(pickLocalizedText("en", { zh: "中文", fallback: "raw" })).toBe(
      "中文",
    );
    expect(pickLocalizedText("zh", { en: "English", fallback: "raw" })).toBe(
      "English",
    );
    expect(pickLocalizedText("en", { fallback: "raw" })).toBe("raw");
    expect(pickLocalizedText("zh", {})).toBeNull();
  });

  test("can require same-locale text without opposite-locale fallback", () => {
    expect(pickSameLocaleText("en", { en: "English", zh: "中文" })).toBe(
      "English",
    );
    expect(pickSameLocaleText("zh", { en: "English", zh: "中文" })).toBe(
      "中文",
    );
    expect(pickSameLocaleText("en", { zh: "中文" })).toBeNull();
    expect(pickSameLocaleText("zh", { en: "English" })).toBeNull();
  });
});
