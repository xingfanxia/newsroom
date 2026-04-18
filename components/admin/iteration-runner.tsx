"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AgentConsole } from "./agent-console";
import { DiffViewer } from "./diff-viewer";
import type { DiffLine, IterationConsoleLine } from "@/lib/types";

export type RunnerStatus =
  | "idle"
  | "running"
  | "proposed"
  | "applied"
  | "rejected"
  | "failed";

type Props = {
  /** Current derived status — computed server-side from latest iteration row. */
  status: RunnerStatus;
  /** The row being displayed (if any). Null while idle before first run. */
  runId: number | null;
  /** Policy version this proposal was based on. */
  baseVersion: number;
  /** Most recently applied version (for console narration). */
  appliedVersion: number | null;
  feedbackCount: number;
  /** Narrative diff lines computed server-side from agentOutput. */
  diff: DiffLine[] | null;
  /** Short reasoning summary from the agent. Shown above the diff. */
  reasoningSummary: string | null;
  /** Error detail when status === 'failed'. */
  errorDetail: string | null;
  /** Minimum feedback the backend enforces — used for the refused message. */
  minFeedbackToIterate: number;
};

const TERMINAL: readonly RunnerStatus[] = ["idle", "applied", "rejected", "failed"];

export function IterationRunner(props: Props) {
  const router = useRouter();
  const t = useTranslations("iteration");
  const [status, setStatus] = useState<RunnerStatus>(props.status);
  const [pending, setPending] = useState(false);

  async function handleStart() {
    setPending(true);
    setStatus("running");
    try {
      const res = await fetch("/api/admin/iterations/run", {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (res.status === 400 && body.error === "insufficient_feedback") {
        toast.error(
          t("errors.insufficientFeedback", {
            count: props.feedbackCount,
            min: props.minFeedbackToIterate,
          }),
        );
        setStatus(props.status);
        return;
      }
      if (!res.ok) {
        toast.error(
          body.detail
            ? `${t("errors.agentFailed")} (${body.detail})`
            : t("errors.agentFailed"),
        );
        setStatus("failed");
        return;
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error(t("errors.generic"));
      setStatus("failed");
    } finally {
      setPending(false);
    }
  }

  async function handleApply() {
    if (!props.runId) return;
    setPending(true);
    try {
      const res = await fetch(
        `/api/admin/iterations/${props.runId}/apply`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        version?: number;
      };
      if (!res.ok) {
        toast.error(t("errors.applyFailed"));
        return;
      }
      toast.success(
        t("diff.toast", { version: body.version ?? "?" }),
      );
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error(t("errors.applyFailed"));
    } finally {
      setPending(false);
    }
  }

  async function handleReject() {
    if (!props.runId) return;
    setPending(true);
    try {
      const res = await fetch(
        `/api/admin/iterations/${props.runId}/reject`,
        { method: "POST" },
      );
      if (!res.ok) {
        toast.error(t("errors.rejectFailed"));
        return;
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error(t("errors.rejectFailed"));
    } finally {
      setPending(false);
    }
  }

  const consoleLines = buildConsoleLines({
    status,
    baseVersion: props.baseVersion,
    appliedVersion: props.appliedVersion,
    feedbackCount: props.feedbackCount,
    minFeedbackToIterate: props.minFeedbackToIterate,
    errorDetail: props.errorDetail,
  });

  const canStart = TERMINAL.includes(status);
  const showDiffSection = status === "proposed" && props.diff;

  return (
    <>
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
          <Button
            variant="primary"
            size="md"
            onClick={handleStart}
            disabled={!canStart || pending}
          >
            {status === "running" || pending
              ? t("console.running")
              : t("console.start")}
          </Button>
        </header>
        <AgentConsole lines={consoleLines} />
        {props.reasoningSummary ? (
          <p className="mt-4 whitespace-pre-wrap text-[13.5px] leading-[1.9] text-[var(--color-fg-muted)]">
            {props.reasoningSummary}
          </p>
        ) : null}
      </section>

      <section className="surface-elevated p-6">
        <header className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-[18px] font-[590] tracking-tight text-[var(--color-fg)]">
            {t("diff.title")}
          </h3>
          {showDiffSection ? (
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleApply}
                disabled={pending}
              >
                {pending ? t("diff.applying") : t("diff.apply")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReject}
                disabled={pending}
              >
                {pending ? t("diff.rejecting") : t("diff.cancel")}
              </Button>
            </div>
          ) : null}
        </header>
        {showDiffSection && props.diff ? (
          <DiffViewer lines={props.diff} />
        ) : (
          <p className="rounded-lg border border-[var(--color-border-subtle)] bg-black/20 px-5 py-6 text-[13px] text-[var(--color-fg-dim)]">
            {t("diff.empty")}
          </p>
        )}
      </section>
    </>
  );
}

function buildConsoleLines(args: {
  status: RunnerStatus;
  baseVersion: number;
  appliedVersion: number | null;
  feedbackCount: number;
  minFeedbackToIterate: number;
  errorDetail: string | null;
}): IterationConsoleLine[] {
  const head: IterationConsoleLine[] = [
    {
      key: "loadedFeedback",
      kind: "info",
      params: { total: args.feedbackCount, agreed: "?", disagreed: "?" },
    },
  ];
  if (args.status === "idle") {
    head.push({
      key: "idle",
      kind: "info",
      params: { version: args.baseVersion },
    });
    return head;
  }
  if (args.status === "running") {
    head.push({ key: "agentStart", kind: "reading" });
    head.push({ key: "working", kind: "reading" });
    return head;
  }
  if (args.status === "proposed") {
    head.push({ key: "sessionOpen", kind: "done" });
    head.push({ key: "finishing", kind: "done" });
    head.push({ key: "awaitingReview", kind: "success" });
    return head;
  }
  if (args.status === "applied") {
    head.push({
      key: "applied",
      kind: "success",
      params: { version: args.appliedVersion ?? args.baseVersion },
    });
    return head;
  }
  if (args.status === "rejected") {
    head.push({ key: "rejected", kind: "info" });
    return head;
  }
  // failed
  head.push({
    key: "failedLine",
    kind: "info",
    params: { detail: args.errorDetail ?? "?" },
  });
  return head;
}
