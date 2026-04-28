import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { Item } from "@/components/feed/item";
import { DayBreak } from "../_day-break";
import { groupByDay } from "@/lib/feed/group-by-day";
import { CollectionSidebar } from "@/components/saved/collection-sidebar";
import { SavedMetaStrip } from "@/components/saved/saved-meta-strip";
import { SavedTags } from "@/components/saved/saved-tags";
import { getSavedStories, getSavedTags, getSavedTotals } from "@/lib/items/saved";
import { getInboxCount, listCollections } from "@/lib/items/collections";
import { getPulseData, getRadarStats } from "@/lib/shell/dashboard-stats";
import { ADMIN_USER_ID, getSessionUser, upsertAppUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function parseCollection(raw: string | undefined): number | "inbox" | undefined {
  if (!raw || raw === "all") return undefined;
  if (raw === "inbox") return "inbox";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default async function SavedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ collection?: string }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);

  const user = await getSessionUser();
  const userId = user?.id ?? ADMIN_USER_ID;
  if (user) await upsertAppUser(user);

  const collectionParam = parseCollection(sp.collection);
  const activeId: number | "inbox" =
    collectionParam === "inbox"
      ? "inbox"
      : typeof collectionParam === "number"
        ? collectionParam
        : "inbox";
  const collectionFilter: number | "inbox" | null =
    collectionParam ?? "inbox"; // default view = inbox

  const [
    stories,
    collections,
    inboxCount,
    totals,
    tags,
    stats,
    pulse,
  ] = await Promise.all([
    getSavedStories(userId, locale as "zh" | "en", {
      collection: collectionFilter,
    }).catch(() => []),
    listCollections(userId).catch(() => []),
    getInboxCount(userId).catch(() => 0),
    getSavedTotals(userId).catch(() => ({ total: 0, thisWeek: 0, thisMonth: 0 })),
    getSavedTags(userId, { collection: collectionFilter }).catch(() => []),
    getRadarStats().catch(() => ({
      items_today: 0,
      items_p1: 0,
      items_featured: 0,
      tracked_sources: 0,
    })),
    getPulseData().catch(() => []),
  ]);

  const sorted = [...stories].sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
  const grouped = groupByDay(sorted);
  const activeCollectionName = (() => {
    if (activeId === "inbox") return locale === "zh" ? "收件箱" : "inbox";
    const c = collections.find((x) => x.id === activeId);
    if (!c) return locale === "zh" ? "收件箱" : "inbox";
    return locale === "zh" ? c.nameCjk || c.name : c.name;
  })();

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{
        tracked_sources: stats.tracked_sources,
        signal_ratio: 0.72,
      }}
      pulse={pulse}
      crumb={
        activeId === "inbox"
          ? "~/saved"
          : `~/saved/${activeCollectionName.replace(/\s+/g, "-").toLowerCase()}`
      }
      cmd="cat bookmarks/*.json | wc -l"
    >
      <main className="main">
        <PageHead
          en="saved"
          cjk="收藏"
          count={totals.total}
          countLabel={locale === "zh" ? "收藏" : "items"}
          extra={
            <span>
              {locale === "zh"
                ? `本周 ${totals.thisWeek} · 本月 ${totals.thisMonth}`
                : `${totals.thisWeek} this week · ${totals.thisMonth} this month`}
            </span>
          }
        />

        <div
          className="saved-layout"
          style={{
            display: "grid",
            gridTemplateColumns: "240px 1fr",
            gap: 18,
            marginTop: 14,
          }}
        >
          <div>
            <CollectionSidebar
              locale={locale as "en" | "zh"}
              collections={collections}
              inboxCount={inboxCount}
              activeId={activeId}
            />
            <SavedTags tags={tags} />
          </div>

          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
                paddingBottom: 10,
                borderBottom: "1px dashed var(--border-1)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
            >
              <span
                style={{
                  color: "var(--accent-orange)",
                  fontWeight: 700,
                  fontFamily:
                    locale === "zh" ? "var(--font-sans-cjk)" : "var(--font-mono)",
                }}
              >
                ▸ {activeCollectionName}
              </span>
              <span style={{ color: "var(--fg-3)", fontSize: 10.5 }}>
                {stories.length} {locale === "zh" ? "条" : "saved"}
              </span>
              <span style={{ flex: 1 }} />
              <a
                href={`/api/saved/export?collection=${activeId}&locale=${locale}`}
                className="act-btn"
                style={{ fontSize: 10.5, padding: "4px 10px" }}
              >
                <span>⇓</span> {locale === "zh" ? "导出 MD" : "export MD"}
              </a>
            </div>

            {stories.length === 0 ? (
              <div
                style={{
                  padding: 60,
                  textAlign: "center",
                  color: "var(--fg-3)",
                  border: "1px dashed var(--border-1)",
                  borderRadius: 2,
                  marginTop: 10,
                }}
              >
                {locale === "zh" ? "当前收藏夹为空 · " : "nothing saved here yet · "}
                <span style={{ color: "var(--accent-green)" }}>⌘S</span>{" "}
                {locale === "zh" ? "从信息流保存" : "to save from the feed"}
              </div>
            ) : (
              <div className="feed">
                {Object.entries(grouped).map(([dayKey, list]) => (
                  <div key={dayKey}>
                    <DayBreak dayKey={dayKey} />
                    {list.map((s) => (
                      <div
                        key={s.id}
                        style={{
                          borderTop: "1px solid var(--border-1)",
                          paddingTop: 10,
                        }}
                      >
                        <SavedMetaStrip
                          itemId={Number.parseInt(s.id, 10)}
                          itemUrl={s.url}
                          savedAt={s.savedAt}
                          currentCollectionId={s.collectionId}
                          collections={collections}
                        />
                        <Item story={s} locale={locale as "en" | "zh"} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </ViewShell>
  );
}
