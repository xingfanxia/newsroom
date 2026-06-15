import type { SavedCollection } from "@/lib/items/collections";

export type SavedCollectionViewId = number | "inbox";

export type SavedCollectionSelection = {
  activeId: SavedCollectionViewId;
  collectionFilter: SavedCollectionViewId;
  shouldRedirect: boolean;
};

export function parseSavedCollectionParam(
  raw: string | undefined,
): SavedCollectionViewId | undefined {
  if (!raw || raw === "all") return undefined;
  if (raw === "inbox") return "inbox";
  if (!/^\d+$/.test(raw)) return undefined;

  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

export function resolveSavedCollectionSelection(
  raw: string | undefined,
  collections: Array<Pick<SavedCollection, "id">>,
): SavedCollectionSelection {
  const parsed = parseSavedCollectionParam(raw);

  if (typeof parsed === "number") {
    const exists = collections.some((collection) => collection.id === parsed);
    return exists
      ? { activeId: parsed, collectionFilter: parsed, shouldRedirect: false }
      : {
          activeId: "inbox",
          collectionFilter: "inbox",
          shouldRedirect: true,
        };
  }

  return {
    activeId: "inbox",
    collectionFilter: "inbox",
    shouldRedirect: false,
  };
}
