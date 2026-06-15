import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

const collectionSidebar = read("components/saved/collection-sidebar.tsx");
const savedMetaStrip = read("components/saved/saved-meta-strip.tsx");

describe("saved UI source wiring", () => {
  test("collection CRUD avoids native browser prompt/confirm flows", () => {
    expect(collectionSidebar).not.toContain("prompt(");
    expect(collectionSidebar).not.toContain("confirm(");
    expect(collectionSidebar).toContain("CollectionFormPanel");
    expect(collectionSidebar).toContain("DeleteCollectionPanel");
  });

  test("collection row actions render inline instead of absolute dropdowns", () => {
    expect(collectionSidebar).not.toContain('position: "absolute"');
    expect(collectionSidebar).not.toContain('top: "100%"');
    expect(collectionSidebar).toContain("CollectionMenuPanel");
  });

  test("saved item removal uses an inline confirmation instead of native confirm", () => {
    expect(savedMetaStrip).not.toContain("confirm(");
    expect(savedMetaStrip).toContain("removeConfirmOpen");
    expect(savedMetaStrip).toContain("RemoveSavedConfirmPanel");
  });
});
