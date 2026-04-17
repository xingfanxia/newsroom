import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
import { MetricCard } from "@/components/admin/metric-card";
import { FeedbackItem } from "@/components/admin/feedback-item";
import { AgentConsole } from "@/components/admin/agent-console";
import { DiffViewer } from "@/components/admin/diff-viewer";
import { VersionPill } from "@/components/admin/version-pill";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import {
  mockConsoleLines,
  mockDiffLines,
  mockVersionHistory,
} from "@/lib/mock/iterations";
import {
  getFeedbackCounts,
  getRecentFeedback,
} from "@/lib/feedback/metrics";
import { ChevronDown } from "lucide-react";

export default async function IterationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("iteration");
  const trm = await getTranslations("iteration.metrics");

  const [counts, recent] = await Promise.all([
    getFeedbackCounts(),
    getRecentFeedback(locale === "en" ? "en" : "zh", 10),
  ]);
  const { total, agreed, disagreed } = counts;

  const currentVersion = mockVersionHistory[0];
  const committedDate = new Date(currentVersion.committedAt).toLocaleDateString(
    locale === "zh" ? "zh-CN" : "en-US",
    { year: "numeric", month: "2-digit", day: "2-digit" },
  );

  return (
    <>
      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-canvas)]/80 px-8 py-3.5 backdrop-blur-md">
        <h1 className="text-[15px] font-[510] text-[var(--color-fg)]">
          {t("title")}
        </h1>
        <LocaleSwitcher />
      </header>

      <div className="px-8 py-8">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
          {/* Hero card + readiness panel */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_352px]">
            <section className="surface-featured px-8 py-7">
              <h2 className="text-[24px] font-[590] tracking-[-0.288px] text-[var(--color-fg)]">
                {t("title")}
              </h2>
              <p className="mt-1.5 max-w-[560px] text-[14.5px] leading-relaxed text-[var(--color-fg-muted)]">
                {t("subtitle")}
              </p>
              <div className="mt-5 flex items-center gap-2">
                <VersionPill version={currentVersion.version} />
                <span className="font-mono text-[12px] tabular text-[var(--color-fg-dim)]">
                  {committedDate}
                </span>
              </div>
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
              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="primary" size="sm">
                  {t("viewLiveSamples")}
                </Button>
                <Button variant="ghost" size="sm">
                  {t("returnToPolicy")}
                </Button>
              </div>
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

          {/* Agent console */}
          <section className="surface-elevated p-6">
            <header className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[18px] font-[590] tracking-tight text-[var(--color-fg)]">
                  {t("console.title")}
                </h3>
                <p className="mt-1 text-[13px] text-[var(--color-fg-dim)]">
                  {t("console.subtitle")}
                </p>
              </div>
              <Button variant="primary" size="md">
                {t("console.start")}
              </Button>
            </header>
            <AgentConsole lines={mockConsoleLines} />
          </section>

          {/* Diff preview */}
          <section className="surface-elevated p-6">
            <header className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-[18px] font-[590] tracking-tight text-[var(--color-fg)]">
                {t("diff.title")}
              </h3>
              <div className="flex gap-2">
                <Button variant="primary" size="sm">
                  {t("diff.apply")}
                </Button>
                <Button variant="ghost" size="sm">
                  {t("diff.cancel")}
                </Button>
              </div>
            </header>
            <DiffViewer lines={mockDiffLines} />
          </section>

          {/* Version history */}
          <section className="surface-elevated p-6">
            <header className="flex items-center gap-3">
              <ChevronDown size={14} className="text-[var(--color-fg-dim)]" />
              <h3 className="text-[18px] font-[590] tracking-tight text-[var(--color-fg)]">
                {t("versionHistory.title")}
              </h3>
              <span className="text-[12px] font-[510] text-[var(--color-fg-dim)]">
                {t("versionHistory.count", {
                  count: mockVersionHistory.length,
                })}
              </span>
            </header>
            <div className="mt-4 flex flex-col divide-y divide-[var(--color-border-subtle)]">
              {mockVersionHistory.map((v) => (
                <div
                  key={v.version}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-3">
                    <VersionPill version={v.version} />
                    <span className="font-mono text-[12px] tabular text-[var(--color-fg-dim)]">
                      {new Date(v.committedAt).toLocaleString(
                        locale === "zh" ? "zh-CN" : "en-US",
                      )}
                    </span>
                  </div>
                  <span className="text-[12px] text-[var(--color-fg-dim)]">
                    {v.feedbackCount}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
