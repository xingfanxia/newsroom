import { getTranslations, setRequestLocale } from "next-intl/server";
import { MetricCard } from "@/components/admin/metric-card";
import { FeedbackItem } from "@/components/admin/feedback-item";
import { VersionPill } from "@/components/admin/version-pill";
import { IterationRunner } from "@/components/admin/iteration-runner";
import type { RunnerStatus } from "@/components/admin/iteration-runner";
import { VersionTimeline } from "@/components/admin/version-timeline";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { getRadarStats } from "@/lib/shell/dashboard-stats";
import { getFeedbackCounts, getRecentFeedback } from "@/lib/feedback/metrics";
import {
  getActiveSkill,
  listSkillVersions,
} from "@/lib/policy/skill";
import { getLatestIterationRun } from "@/lib/policy/iterations";
import { narrativeDiff, type DiffLine } from "@/lib/policy/diff";
import {
  MIN_FEEDBACK_TO_ITERATE,
  type IterationProposal,
} from "@/workers/agent/prompt";
import { SKILL_NAME } from "@/workers/agent/iterate";

export const dynamic = "force-dynamic";

function deriveStatus(
  run: { status: string } | null,
): RunnerStatus {
  if (!run) return "idle";
  switch (run.status) {
    case "running":
      return "running";
    case "proposed":
      return "proposed";
    case "applied":
      return "applied";
    case "rejected":
      return "rejected";
    case "failed":
      return "failed";
    default:
      return "idle";
  }
}

export default async function IterationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("iteration");
  const trm = await getTranslations("iteration.metrics");

  const [counts, recent, skill, history, latestRun, stats] = await Promise.all([
    getFeedbackCounts(),
    getRecentFeedback(locale === "en" ? "en" : "zh", 10),
    getActiveSkill(SKILL_NAME),
    listSkillVersions(SKILL_NAME),
    getLatestIterationRun(SKILL_NAME),
    getRadarStats().catch(() => ({
      items_today: 0, items_p1: 0, items_featured: 0, tracked_sources: 0,
    })),
  ]);

  const { total, agreed, disagreed } = counts;
  const status = deriveStatus(latestRun);

  let diff: DiffLine[] | null = null;
  if (status === "proposed" && latestRun?.agentOutput) {
    diff = narrativeDiff(
      latestRun.agentOutput as IterationProposal,
      {
        changes: t("narrative.changes"),
        heldBack: t("narrative.heldBack"),
      },
    );
  }

  const currentVersion = history[0] ?? null;
  const committedDate = currentVersion
    ? new Date(currentVersion.committedAt).toLocaleDateString(
        locale === "zh" ? "zh-CN" : "en-US",
        { year: "numeric", month: "2-digit", day: "2-digit" },
      )
    : "";

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={{ tracked_sources: stats.tracked_sources, signal_ratio: 0.72 }}
      crumb="~/admin/iterations"
      cmd="git log --oneline editorial.skill.md"
    >
      <main className="main">
        <PageHead
          en="iterations"
          cjk="策略迭代"
          extra={
            currentVersion ? (
              <span>
                <VersionPill version={`v${currentVersion.version}`} />{" "}
                <span style={{ color: "var(--fg-3)" }}>{committedDate}</span>
              </span>
            ) : null
          }
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Hero card + readiness panel */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_352px]">
            <section className="surface-featured px-8 py-7">
              <h2 className="text-[24px] font-[590] tracking-[-0.288px] text-[var(--color-fg)]">
                {t("title")}
              </h2>
              <p className="mt-1.5 max-w-[560px] text-[14.5px] leading-relaxed text-[var(--color-fg-muted)]">
                {t("subtitle")}
              </p>
              {currentVersion ? (
                <div className="mt-5 flex items-center gap-2">
                  <VersionPill version={`v${currentVersion.version}`} />
                  <span className="font-mono text-[12px] tabular text-[var(--color-fg-dim)]">
                    {committedDate}
                  </span>
                </div>
              ) : null}
            </section>

            <aside className="surface-elevated flex flex-col gap-4 p-6">
              <div className="text-[13px] font-[510] text-[var(--color-fg-muted)]">
                {t("readinessTitle")}
              </div>
              <div className="text-[18px] font-[590] tracking-tight text-[var(--color-fg)] leading-snug">
                {t("readinessHeadline")}
              </div>
              <p className="text-[13px] leading-relaxed text-[var(--color-fg-dim)]">
                {t("readinessDescription", { count: total })}
              </p>
            </aside>
          </div>

          {/* Metric row */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <MetricCard
              label={trm("totalFeedback")}
              value={total}
              note={trm("totalFeedbackNote")}
            />
            <MetricCard
              label={trm("agreed")}
              value={agreed}
              note={trm("agreedNote")}
              tone="positive"
            />
            <MetricCard
              label={trm("disagreed")}
              value={disagreed}
              note={trm("disagreedNote")}
              tone="negative"
            />
          </div>

          {/* Recent feedback */}
          <section className="surface-elevated p-6">
            <header className="flex items-center gap-3">
              <h3 className="text-[18px] font-[590] tracking-tight text-[var(--color-fg)]">
                {t("recent.title")}
              </h3>
              <span className="text-[12px] font-[510] text-[var(--color-fg-dim)]">
                {t("recent.count", { count: total })}
              </span>
            </header>
            <div className="mt-3 flex flex-col">
              {recent.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-[var(--color-fg-dim)]">
                  {t("recent.empty")}
                </p>
              ) : (
                recent.map((f) => (
                  <FeedbackItem
                    key={f.id}
                    entry={f}
                    locale={locale as "zh" | "en"}
                  />
                ))
              )}
            </div>
          </section>

          {/* Agent console + diff (interactive) */}
          <IterationRunner
            status={status}
            runId={latestRun?.id ?? null}
            baseVersion={latestRun?.baseVersion ?? skill.version}
            appliedVersion={skill.version}
            feedbackCount={total}
            diff={diff}
            reasoningSummary={
              status === "proposed" ? latestRun?.reasoningSummary ?? null : null
            }
            errorDetail={
              status === "failed" ? latestRun?.error ?? null : null
            }
            minFeedbackToIterate={MIN_FEEDBACK_TO_ITERATE}
          />

          {/* Version history — vertical timeline */}
          <section className="panel">
            <div className="hd">
              <span className="t">{t("versionHistory.title")}</span>
              <span className="more">
                {t("versionHistory.count", { count: history.length })}
              </span>
            </div>
            <div className="bd" style={{ padding: 18 }}>
              <VersionTimeline
                locale={locale as "en" | "zh"}
                versions={history.map((v) => ({
                  version: v.version,
                  committedAt: new Date(v.committedAt).toISOString(),
                  committedBy: v.committedBy,
                  feedbackCount: v.feedbackCount,
                  reasoning: v.reasoning ?? null,
                }))}
              />
            </div>
          </section>
        </div>
      </main>
    </ViewShell>
  );
}
