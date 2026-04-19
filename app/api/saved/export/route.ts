import { ADMIN_USER_ID, getSessionUser } from "@/lib/auth/session";
import { getSavedStories } from "@/lib/items/saved";
import { listCollections } from "@/lib/items/collections";

/**
 * GET /api/saved/export?collection=<id|inbox|all> — dumps the user's saved
 * items as a Markdown file (Content-Disposition: attachment). Columns are
 * chosen for usefulness in a reading queue: title, publisher, date, score,
 * source URL, editor note when present.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  const userId = user?.id ?? ADMIN_USER_ID;
  const url = new URL(req.url);
  const raw = url.searchParams.get("collection");
  const locale = (url.searchParams.get("locale") ?? "en") === "zh" ? "zh" : "en";

  let collection: number | "inbox" | null = null;
  let suffix = "all";
  if (raw === "inbox") {
    collection = "inbox";
    suffix = "inbox";
  } else if (raw && raw !== "all") {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      collection = n;
      suffix = `coll-${n}`;
    }
  }

  const [stories, collections] = await Promise.all([
    getSavedStories(userId, locale, { collection, limit: 500 }),
    listCollections(userId),
  ]);
  const collLookup = new Map(collections.map((c) => [c.id, c]));

  const title = (() => {
    if (collection === "inbox") return locale === "zh" ? "收件箱" : "Inbox";
    if (typeof collection === "number") {
      const c = collLookup.get(collection);
      return c ? (locale === "zh" ? c.nameCjk || c.name : c.name) : "Saved";
    }
    return locale === "zh" ? "全部收藏" : "All Saved";
  })();

  const dateFmt = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(
    `> exported ${new Date().toISOString().slice(0, 10)} · ${stories.length} items`,
  );
  lines.push("");
  for (const s of stories) {
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
      lines.push(`> **${locale === "zh" ? "编辑点评" : "Editor note"}**: ${s.editorNote}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  const body = lines.join("\n");
  const filename = `saved-${suffix}-${new Date().toISOString().slice(0, 10)}.md`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
