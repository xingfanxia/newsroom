import { getSavedStories } from "@/lib/items/saved";
import {
  listCollections,
  type SavedCollection,
} from "@/lib/items/collections";
import type { AppLocale, Story } from "@/lib/types";

type SavedExportCollectionFilter = number | "inbox" | null;
export type SavedExportStory = Story & {
  savedAt: string;
  collectionId: number | null;
};

export type SavedExportRequest = {
  locale: AppLocale;
  collection: SavedExportCollectionFilter;
  suffix: string;
};

export type SavedExportRenderInput = {
  locale: AppLocale;
  collection: SavedExportCollectionFilter;
  stories: SavedExportStory[];
  collections: SavedCollection[];
  exportedAt?: Date;
};

const SAVED_EXPORT_LIMIT = 500;

export function parseSavedExportRequest(req: Request): SavedExportRequest {
  const url = new URL(req.url);
  const raw = url.searchParams.get("collection");
  const locale: AppLocale =
    url.searchParams.get("locale") === "zh" ? "zh" : "en";

  if (raw === "inbox") {
    return { locale, collection: "inbox", suffix: "inbox" };
  }

  if (raw && raw !== "all") {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      return { locale, collection: n, suffix: `coll-${n}` };
    }
  }

  return { locale, collection: null, suffix: "all" };
}

export async function savedExportResponse(
  req: Request,
  userId: string,
  opts: { exportedAt?: Date } = {},
): Promise<Response> {
  const parsed = parseSavedExportRequest(req);
  const [stories, collections] = await Promise.all([
    getSavedStories(userId, parsed.locale, {
      collection: parsed.collection,
      limit: SAVED_EXPORT_LIMIT,
    }),
    listCollections(userId),
  ]);
  const exportedAt = opts.exportedAt ?? new Date();
  const body = renderSavedExportMarkdown({
    ...parsed,
    stories,
    collections,
    exportedAt,
  });
  return savedExportMarkdownResponse(
    body,
    savedExportFilename(parsed.suffix, exportedAt),
  );
}

export function renderSavedExportMarkdown(
  input: SavedExportRenderInput,
): string {
  const collLookup = collectionLookup(input.collections);
  const title = savedExportTitle(input.collection, input.locale, collLookup);
  const exportedAt = input.exportedAt ?? new Date();
  const dateFmt = new Intl.DateTimeFormat(
    input.locale === "zh" ? "zh-CN" : "en-US",
    {
      year: "numeric",
      month: "short",
      day: "numeric",
    },
  );

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(
    `> exported ${isoDate(exportedAt)} · ${input.stories.length} items`,
  );
  lines.push("");

  for (const s of input.stories) {
    const date = dateFmt.format(new Date(s.publishedAt));
    const colName = s.collectionId
      ? collLookup.get(s.collectionId)?.name ?? "?"
      : "inbox";
    lines.push(`## ${s.title}`);
    lines.push("");
    lines.push(
      `- **${s.source.publisher}** · ${date} · score \`${s.importance}\` · \`#${colName}\``,
    );
    lines.push(`- ${s.url}`);
    if (s.summary) {
      lines.push("");
      lines.push(s.summary);
    }
    if (s.editorNote) {
      lines.push("");
      lines.push(
        `> **${input.locale === "zh" ? "一句话点评" : "Editor take"}**: ${s.editorNote}`,
      );
    }
    if (s.editorAnalysis && s.editorAnalysis !== s.editorNote) {
      lines.push("");
      lines.push(`**${input.locale === "zh" ? "锐评" : "Sharp take"}**`);
      lines.push("");
      lines.push(s.editorAnalysis);
    }
    if (s.reasoning) {
      lines.push("");
      lines.push(
        `_${input.locale === "zh" ? "精选理由" : "Why featured"}: ${s.reasoning}_`,
      );
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

export function savedExportFilename(suffix: string, exportedAt: Date): string {
  return `saved-${suffix}-${isoDate(exportedAt)}.md`;
}

export function savedExportMarkdownResponse(
  body: string,
  filename: string,
): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function savedExportTitle(
  collection: SavedExportCollectionFilter,
  locale: AppLocale,
  collections: Map<number, SavedCollection>,
): string {
  if (collection === "inbox") return locale === "zh" ? "收件箱" : "Inbox";
  if (typeof collection === "number") {
    const c = collections.get(collection);
    return c ? (locale === "zh" ? c.nameCjk || c.name : c.name) : "Saved";
  }
  return locale === "zh" ? "全部收藏" : "All Saved";
}

function collectionLookup(
  collections: SavedCollection[],
): Map<number, SavedCollection> {
  return new Map(collections.map((c) => [c.id, c]));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
