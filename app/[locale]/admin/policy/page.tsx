import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { VersionPill } from "@/components/admin/version-pill";
import { getActiveSkill } from "@/lib/policy/skill";
import { getRadarStats } from "@/lib/shell/dashboard-stats";

export const dynamic = "force-dynamic";

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  let skill: Awaited<ReturnType<typeof getActiveSkill>> | null = null;
  let error: string | null = null;
  try {
    skill = await getActiveSkill("editorial");
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const stats = await getRadarStats().catch(() => ({
    items_today: 0,
    items_p1: 0,
    items_featured: 0,
    tracked_sources: 0,
  }));

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{ tracked_sources: stats.tracked_sources, signal_ratio: 0.72 }}
      crumb="~/admin/policy"
      cmd="cat editorial.skill.md"
    >
      <main className="main">
        <PageHead
          en="curation policy"
          cjk="精选策略"
          extra={skill ? <VersionPill version={`v${skill.version}`} /> : null}
        />
        <pre
          style={{
            background: "var(--bg-1)",
            border: "1px solid var(--border-1)",
            padding: 24,
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            lineHeight: 1.7,
            color: "var(--fg-1)",
            whiteSpace: "pre-wrap",
            overflowX: "auto",
            marginTop: 14,
          }}
        >
          {skill?.content ?? error ?? "editorial.skill.md not found."}
        </pre>
      </main>
    </ViewShell>
  );
}
