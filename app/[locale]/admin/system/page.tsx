import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import {
  totalsByWindow,
  breakdownByTask,
  breakdownByModel,
  recentCalls,
} from "@/lib/llm/stats";

export const dynamic = "force-dynamic";

export default async function SystemPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin.system");

  const [today, week, month, taskWeek, modelWeek, recent] = await Promise.all([
    totalsByWindow("today"),
    totalsByWindow("week"),
    totalsByWindow("month"),
    breakdownByTask("week"),
    breakdownByModel("week"),
    recentCalls(20),
  ]);

  return (
    <>
      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-canvas)]/80 px-8 py-3.5 backdrop-blur-md">
        <div>
          <h1 className="text-[15px] font-[510]">{t("title")}</h1>
          <p className="text-[12px] text-[var(--color-fg-dim)]">
            {t("subtitle")}
          </p>
        </div>
        <LocaleSwitcher />
      </header>

      <div className="px-8 py-8">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-8">
          {/* Spend cards */}
          <section className="grid grid-cols-3 gap-4">
            <SpendCard label="Today" totals={today} />
            <SpendCard label="Past 7 days" totals={week} />
            <SpendCard label="Past 30 days" totals={month} />
          </section>

          {/* Breakdowns */}
          <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="surface-card p-5">
              <h2 className="mb-3 text-[14px] font-[590]">
                Spend by task (7d)
              </h2>
              <TaskTable rows={taskWeek} />
            </div>
            <div className="surface-card p-5">
              <h2 className="mb-3 text-[14px] font-[590]">
                Spend by model (7d)
              </h2>
              <ModelTable rows={modelWeek} />
            </div>
          </section>

          {/* Recent calls */}
          <section className="surface-card p-5">
            <h2 className="mb-3 text-[14px] font-[590]">Recent LLM calls</h2>
            <RecentTable rows={recent} locale={locale} />
          </section>
        </div>
      </div>
    </>
  );
}

function SpendCard({
  label,
  totals,
}: {
  label: string;
  totals: {
    calls: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    costUsd: number;
  };
}) {
  return (
    <div className="surface-card p-5">
      <div className="text-[12px] uppercase tracking-wider text-[var(--color-fg-dim)]">
        {label}
      </div>
      <div className="mt-2 font-mono text-[28px] font-[510] tabular text-[var(--color-cyan)]">
        ${totals.costUsd.toFixed(4)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-[var(--color-fg-dim)]">
        <span>Calls</span>
        <span className="text-right tabular">{totals.calls}</span>
        <span>Input tok.</span>
        <span className="text-right tabular">
          {formatTokens(totals.inputTokens)}
        </span>
        <span>Cached input</span>
        <span className="text-right tabular">
          {formatTokens(totals.cachedInputTokens)}
        </span>
        <span>Output tok.</span>
        <span className="text-right tabular">
          {formatTokens(totals.outputTokens)}
        </span>
        {totals.reasoningTokens > 0 && (
          <>
            <span>Reasoning</span>
            <span className="text-right tabular">
              {formatTokens(totals.reasoningTokens)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function TaskTable({
  rows,
}: {
  rows: {
    task: string | null;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }[];
}) {
  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-fg-dim)]">
        No activity in the last 7 days.
      </p>
    );
  }
  return (
    <table className="w-full text-[13px]">
      <thead className="text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)]">
        <tr>
          <th className="py-1 text-left">Task</th>
          <th className="py-1 text-right">Calls</th>
          <th className="py-1 text-right">Input</th>
          <th className="py-1 text-right">Output</th>
          <th className="py-1 text-right">Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.task ?? "untagged"}
            className="border-t border-[var(--color-border-subtle)]"
          >
            <td className="py-1 font-[510] text-[var(--color-fg-muted)]">
              {r.task ?? "untagged"}
            </td>
            <td className="py-1 text-right tabular">{r.calls}</td>
            <td className="py-1 text-right tabular">
              {formatTokens(r.inputTokens)}
            </td>
            <td className="py-1 text-right tabular">
              {formatTokens(r.outputTokens)}
            </td>
            <td className="py-1 text-right font-mono tabular text-[var(--color-cyan)]">
              ${r.costUsd.toFixed(4)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ModelTable({
  rows,
}: {
  rows: { provider: string; model: string; calls: number; costUsd: number }[];
}) {
  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-fg-dim)]">
        No activity in the last 7 days.
      </p>
    );
  }
  return (
    <table className="w-full text-[13px]">
      <thead className="text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)]">
        <tr>
          <th className="py-1 text-left">Model</th>
          <th className="py-1 text-right">Calls</th>
          <th className="py-1 text-right">Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={`${r.provider}/${r.model}`}
            className="border-t border-[var(--color-border-subtle)]"
          >
            <td className="py-1 font-[510] text-[var(--color-fg-muted)]">
              <div>{r.model}</div>
              <div className="text-[11px] text-[var(--color-fg-dim)]">
                {r.provider}
              </div>
            </td>
            <td className="py-1 text-right tabular">{r.calls}</td>
            <td className="py-1 text-right font-mono tabular text-[var(--color-cyan)]">
              ${r.costUsd.toFixed(4)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecentTable({
  rows,
  locale,
}: {
  rows: {
    id: number;
    task: string | null;
    model: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    costUsd: number | null;
    durationMs: number | null;
    createdAt: Date;
  }[];
  locale: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-fg-dim)]">
        No calls recorded yet. Usage rows populate as workers run.
      </p>
    );
  }
  const timeFmt = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <table className="w-full text-[13px]">
      <thead className="text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)]">
        <tr>
          <th className="py-1 text-left">Time</th>
          <th className="py-1 text-left">Task</th>
          <th className="py-1 text-left">Model</th>
          <th className="py-1 text-right">In</th>
          <th className="py-1 text-right">Cached</th>
          <th className="py-1 text-right">Out</th>
          <th className="py-1 text-right">Reasoning</th>
          <th className="py-1 text-right">Dur</th>
          <th className="py-1 text-right">Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.id}
            className="border-t border-[var(--color-border-subtle)]"
          >
            <td className="py-1 font-mono text-[12px] text-[var(--color-fg-dim)]">
              {timeFmt.format(r.createdAt)}
            </td>
            <td className="py-1 text-[var(--color-fg-muted)]">
              {r.task ?? "—"}
            </td>
            <td className="py-1 font-mono text-[12px] text-[var(--color-fg-muted)]">
              {r.model}
            </td>
            <td className="py-1 text-right tabular">{r.inputTokens}</td>
            <td className="py-1 text-right tabular">
              {r.cachedInputTokens || "—"}
            </td>
            <td className="py-1 text-right tabular">{r.outputTokens}</td>
            <td className="py-1 text-right tabular">
              {r.reasoningTokens || "—"}
            </td>
            <td className="py-1 text-right tabular text-[var(--color-fg-dim)]">
              {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}
            </td>
            <td className="py-1 text-right font-mono tabular text-[var(--color-cyan)]">
              {r.costUsd !== null ? `$${r.costUsd.toFixed(6)}` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
