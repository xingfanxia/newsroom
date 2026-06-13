const TAG_AXES = ["capabilities", "entities", "topics"] as const;

type ItemTagAxis = (typeof TAG_AXES)[number];
type ItemTagBag = Partial<Record<ItemTagAxis, unknown>>;

export function flattenItemTags(value: unknown, limit: number): string[] {
  if (limit <= 0 || !isTagBag(value)) return [];

  return TAG_AXES.flatMap((axis) => stringsOnly(value[axis])).slice(0, limit);
}

function isTagBag(value: unknown): value is ItemTagBag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringsOnly(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
