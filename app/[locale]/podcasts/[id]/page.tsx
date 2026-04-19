import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { Prose } from "@/components/markdown/prose";
import { Transcript } from "@/components/podcasts/transcript";
import { YouTubeEmbed, extractYouTubeId } from "@/components/podcasts/youtube-embed";
import { ViewShell } from "@/components/shell/view-shell";
import { getItemDetail } from "@/lib/items/detail";
import { getRadarStats } from "@/lib/shell/dashboard-stats";

// Re-render every 5 min — commentary + transcript only change via background
// jobs, so there's no need to hit the DB on every navigation.
export const revalidate = 300;

export default async function PodcastDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id: idRaw } = await params;
  setRequestLocale(locale);

  const id = Number.parseInt(idRaw, 10);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const [detail, stats] = await Promise.all([
    getItemDetail(id, locale === "en" ? "en" : "zh"),
    getRadarStats().catch(() => ({
      items_today: 0, items_p1: 0, items_featured: 0, tracked_sources: 0,
    })),
  ]);
  if (!detail) notFound();

  const { story, bodyMd } = detail;
  const publishedDate = new Date(story.publishedAt).toISOString().slice(0, 10);
  const isYouTube = extractYouTubeId(story.url) !== null;

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{ tracked_sources: stats.tracked_sources, signal_ratio: 0.72 }}
      crumb={`~/podcasts/${id}`}
      cmd={`cat ${id}.transcript.md`}
    >
      <main className="main" style={{ maxWidth: 860 }}>
        <Link
          href={`/${locale}/podcasts`}
          className="nav-it"
          style={{
            width: "fit-content",
            fontSize: 11,
            padding: "4px 8px",
            marginBottom: 18,
            color: "var(--fg-3)",
            textDecoration: "none",
            border: "0",
          }}
        >
          <span className="dot-marker" /> ← back to podcasts
        </Link>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            fontSize: 11.5,
            color: "var(--fg-2)",
            marginBottom: 10,
          }}
        >
          {story.featured ? <span className="tier-f">FEATURED</span> : null}
          <span className="src" style={{ color: "var(--fg-1)", fontWeight: 500 }}>
            {story.source.publisher}
          </span>
          <span style={{ color: "var(--border-2)" }}>·</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {publishedDate}
          </span>
        </div>

        <h1
          style={{
            fontFamily:
              locale === "zh" ? "var(--font-sans-cjk)" : "var(--font-mono)",
            fontSize: 28,
            lineHeight: 1.25,
            letterSpacing: "-0.01em",
            color: "var(--fg-0)",
            marginTop: 4,
          }}
        >
          {story.title}
        </h1>

        {story.summary && (
          <p
            style={{
              marginTop: 16,
              fontSize: 14.5,
              lineHeight: 1.75,
              color: "var(--fg-1)",
              maxWidth: 720,
            }}
          >
            {story.summary}
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
          {isYouTube && <YouTubeEmbed url={story.url} title={story.title} />}
          <a
            href={story.url}
            target="_blank"
            rel="noreferrer"
            className="act-btn primary"
            style={{ width: "fit-content" }}
          >
            <span>→</span> listen at source
          </a>
        </div>

        {story.editorNote && (
          <section
            style={{
              marginTop: 40,
              padding: "14px 16px",
              background: "var(--bg-1)",
              border: "1px solid var(--border-1)",
              borderLeft: "2px solid var(--accent-blue)",
              borderRadius: 4,
            }}
          >
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                color: "var(--accent-blue)",
                marginBottom: 6,
              }}
            >
              {locale === "zh" ? "编辑点评" : "editor note"}
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fg-0)" }}>
              {story.editorNote}
            </p>
          </section>
        )}

        {story.editorAnalysis && (
          <section style={{ marginTop: 32 }}>
            <h2
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                color: "var(--accent-blue)",
                marginBottom: 12,
                paddingBottom: 8,
                borderBottom: "1px dashed var(--border-1)",
              }}
            >
              {locale === "zh" ? "深度解读" : "deep take"}
            </h2>
            <div style={{ color: "var(--fg-1)", fontSize: 14, lineHeight: 1.75 }}>
              <Prose>{story.editorAnalysis}</Prose>
            </div>
          </section>
        )}

        <section style={{ marginTop: 40 }}>
          <Transcript bodyMd={bodyMd} />
        </section>
      </main>
    </ViewShell>
  );
}
