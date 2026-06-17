import { setRequestLocale } from "next-intl/server";
import { AdminMonoBlock } from "@/components/admin/mono-block";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { PolicyEditor } from "@/components/admin/policy-editor";
import { getActiveSkill } from "@/lib/policy/skill";
import { getRadarStats } from "@/lib/shell/dashboard-stats";
import { EMPTY_RADAR_STATS } from "@/lib/shell/radar-stats";
import { topBarStatsFromRadar } from "@/lib/shell/top-bar-stats";
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
  const stats = await getRadarStats().catch(() => EMPTY_RADAR_STATS);

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={topBarStatsFromRadar(stats)}
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
          <AdminMonoBlock
            tone="error"
            style={{
              padding: 24,
              lineHeight: 1.7,
              marginTop: 14,
            }}
          >
            {error ?? "editorial.skill.md not found."}
          </AdminMonoBlock>
        )}
      </main>
    </ViewShell>
  );
}
