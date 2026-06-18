import { describe, expect, test } from "bun:test";
import {
  parseSavedCollectionParam,
  resolveSavedCollectionSelection,
} from "@/lib/items/saved-collection-selection";
import { readSource as read } from "@/tests/helpers/source";

describe("saved collection URL selection", () => {
  test("normalizes empty, all, and inbox params to the inbox view", () => {
    expect(parseSavedCollectionParam(undefined)).toBeUndefined();
    expect(parseSavedCollectionParam("all")).toBeUndefined();
    expect(parseSavedCollectionParam("inbox")).toBe("inbox");

    expect(resolveSavedCollectionSelection(undefined, [])).toEqual({
      activeId: "inbox",
      collectionFilter: "inbox",
      shouldRedirect: false,
    });
  });

  test("keeps existing named collection ids and redirects stale ids to inbox", () => {
    const collections = [{ id: 7 }, { id: 11 }];

    expect(resolveSavedCollectionSelection("7", collections)).toEqual({
      activeId: 7,
      collectionFilter: 7,
      shouldRedirect: false,
    });

    expect(resolveSavedCollectionSelection("42", collections)).toEqual({
      activeId: "inbox",
      collectionFilter: "inbox",
      shouldRedirect: true,
    });
  });

  test("saved page uses the shared resolver before querying saved stories", () => {
    const source = read("app/[locale]/saved/page.tsx");

    expect(source).toContain("resolveSavedCollectionSelection");
    expect(source).toContain("const appLocale = appLocaleFromParam(locale)");
    expect(source).toContain("redirect(`/${appLocale}/saved`)");
    expect(source).not.toContain("function parseCollection");
  });
});
