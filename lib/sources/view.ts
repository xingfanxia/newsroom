export const SOURCES_VIEWS = ["table", "cards"] as const;
export type SourcesView = (typeof SOURCES_VIEWS)[number];
export const DEFAULT_SOURCES_VIEW = SOURCES_VIEWS[0];

export const SOURCES_VIEW_LABELS = {
  table: { icon: "☰", en: "table", zh: "表格" },
  cards: { icon: "▦", en: "cards", zh: "卡片" },
} as const satisfies Record<SourcesView, { icon: string; en: string; zh: string }>;

const SOURCES_VIEW_SET = new Set<string>(SOURCES_VIEWS);

export function coerceSourcesView(
  value: string | null | undefined,
): SourcesView {
  return value && SOURCES_VIEW_SET.has(value)
    ? (value as SourcesView)
    : DEFAULT_SOURCES_VIEW;
}
