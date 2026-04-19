import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { PolicyEditor } from "@/components/admin/policy-editor";
import { getActiveSkill } from "@/lib/policy/skill";
import { getRadarStats } from "@/lib/shell/dashboard-stats";
import { SKILL_NAME } from "@/workers/agent/iterate";

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
      cmd="vi editorial.skill.md"
    >
      <main className="main">
        <PageHead
          en="curation policy"
          cjk="精选策略"
          extra={
            <span>
              {locale === "zh"
                ? "直接编辑会作为新版本提交，与 agent 迭代共用版本历史"
                : "direct edits commit as a new version alongside agent iterations"}
            </span>
          }
        />
        {skill ? (
          <PolicyEditor
            skillName={SKILL_NAME}
            initialContent={skill.content}
            version={skill.version}
          />
        ) : (
          <pre
            style={{
              background: "var(--bg-1)",
              border: "1px solid var(--border-1)",
              padding: 24,
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              lineHeight: 1.7,
              color: "var(--accent-red)",
              whiteSpace: "pre-wrap",
              marginTop: 14,
              borderRadius: 2,
            }}
          >
            {error ?? "editorial.skill.md not found."}
          </pre>
        )}
      </main>
    </ViewShell>
  );
}
