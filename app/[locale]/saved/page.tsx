import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { Item } from "@/components/feed/item";
import { DayBreak } from "../_day-break";
import { getSavedCollections, getSavedStories } from "@/lib/items/saved";
import { getPulseData, getRadarStats } from "@/lib/shell/dashboard-stats";
import { getSessionUser, ADMIN_USER_ID } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SavedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await getSessionUser();
  const userId = user?.id ?? ADMIN_USER_ID;

  const [stories, collections, stats, pulse] = await Promise.all([
    getSavedStories(userId, locale as "zh" | "en").catch(() => []),
    getSavedCollections(userId).catch(() => []),
    getRadarStats().catch(() => ({
      items_today: 0,
      items_p1: 0,
      items_featured: 0,
      tracked_sources: 0,
    })),
    getPulseData().catch(() => []),
  ]);

  const grouped = groupByDay(stories);

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{
        tracked_sources: stats.tracked_sources,
        signal_ratio: 0.72,
      }}
      pulse={pulse}
      crumb="~/saved"
      cmd="cat bookmarks/*.json | wc -l"
    >
      <main className="main">
        <PageHead
          en="saved"
          cjk="收藏"
          count={stories.length}
          countLabel="items"
          extra={<span>synced · last sync 2m ago</span>}
        />
        <div
          className="saved-layout"
          style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 18, marginTop: 14 }}
        >
          <aside className="coll-list">
            <div
              className="sec"
              style={{ padding: 0, marginBottom: 6 }}
            >
              <span>collections</span>
              <span className="sec-c">{collections.length}</span>
            </div>
            {collections.map((c) => (
              <div key={c.id} className="watch-row" style={{ padding: "8px 4px" }}>
                <span className="sym">▸</span>
                <span className="q">{c.label}</span>
                <span className="hits">{c.count}</span>
                <span />
              </div>
            ))}
            <div
              style={{
                marginTop: 14,
                paddingTop: 10,
                borderTop: "1px dashed var(--border-1)",
                fontSize: 10.5,
                color: "var(--fg-3)",
                letterSpacing: "0.02em",
              }}
            >
              ⌘S on any item · remove to unsave
            </div>
          </aside>
          <div>
            {stories.length === 0 ? (
              <div
                style={{
                  padding: 60,
                  textAlign: "center",
                  color: "var(--fg-3)",
                  border: "1px dashed var(--border-1)",
                  borderRadius: 4,
                }}
              >
                no saved items yet ·{" "}
                <span style={{ color: "var(--accent-green)" }}>⌘S</span> to save
                from the feed
              </div>
            ) : (
              <div className="feed">
                {Object.entries(grouped).map(([dayKey, list]) => (
                  <div key={dayKey}>
                    <DayBreak date={new Date(dayKey)} />
                    {list.map((s) => (
                      <Item
                        key={s.id}
                        story={s}
                        locale={locale as "en" | "zh"}
                      />
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

function groupByDay(
  stories: Awaited<ReturnType<typeof getSavedStories>>,
): Record<string, typeof stories> {
  const sorted = [...stories].sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
  const byDay: Record<string, typeof stories> = {};
  for (const s of sorted) {
    const d = new Date(s.publishedAt);
    const canonical = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
    ).toISOString();
    (byDay[canonical] ??= []).push(s);
  }
  return byDay;
}
