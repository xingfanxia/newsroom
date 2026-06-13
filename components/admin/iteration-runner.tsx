"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AgentConsole } from "./agent-console";
import { DiffViewer } from "./diff-viewer";
import {
  ITERATION_APPLIED_STATUS,
  ITERATION_FAILED_STATUS,
  ITERATION_IDLE_STATUS,
  ITERATION_PROPOSED_STATUS,
  ITERATION_REJECTED_STATUS,
  ITERATION_RUNNING_STATUS,
  ITERATION_RUNNER_TERMINAL_STATUSES,
  type DiffLine,
  type IterationConsoleLine,
  type IterationRunnerStatus,
} from "@/lib/types";

export type RunnerStatus = IterationRunnerStatus;

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

const TERMINAL: readonly RunnerStatus[] = ITERATION_RUNNER_TERMINAL_STATUSES;

export function IterationRunner(props: Props) {
  const router = useRouter();
  const t = useTranslations("iteration");
  const [status, setStatus] = useState<RunnerStatus>(props.status);
  const [pending, setPending] = useState(false);

  async function handleStart() {
    setPending(true);
    setStatus(ITERATION_RUNNING_STATUS);
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
        setStatus(ITERATION_FAILED_STATUS);
        return;
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error(t("errors.generic"));
      setStatus(ITERATION_FAILED_STATUS);
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
  const showDiffSection = status === ITERATION_PROPOSED_STATUS && props.diff;

  return (
    <>
      <section className="panel">
        <div className="hd">
          <span className="t">{t("console.title")}</span>
          <button
            type="button"
            className="act-btn primary"
            onClick={handleStart}
            disabled={!canStart || pending}
            style={{ cursor: !canStart || pending ? "not-allowed" : "pointer" }}
          >
            <span>
              {status === ITERATION_RUNNING_STATUS || pending ? "◐" : "▶"}
            </span>
            {status === ITERATION_RUNNING_STATUS || pending
              ? t("console.running")
              : t("console.start")}
          </button>
        </div>
        <div className="bd" style={{ padding: 16 }}>
          <p
            style={{
              fontSize: 11.5,
              color: "var(--fg-3)",
              marginBottom: 12,
              lineHeight: 1.6,
            }}
          >
            {t("console.subtitle")}
          </p>
          <AgentConsole lines={consoleLines} />
          {props.reasoningSummary && (
            <p
              style={{
                marginTop: 14,
                padding: 12,
                background: "var(--bg-2)",
                border: "1px solid var(--border-1)",
                borderRadius: 2,
                whiteSpace: "pre-wrap",
                fontSize: 12.5,
                lineHeight: 1.75,
                color: "var(--fg-1)",
              }}
            >
              {props.reasoningSummary}
            </p>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="hd">
          <span className="t">{t("diff.title")}</span>
          {showDiffSection && (
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className="act-btn primary"
                onClick={handleApply}
                disabled={pending}
                style={{ cursor: pending ? "not-allowed" : "pointer" }}
              >
                <span>✓</span>
                {pending ? t("diff.applying") : t("diff.apply")}
              </button>
              <button
                type="button"
                className="act-btn"
                onClick={handleReject}
                disabled={pending}
                style={{ cursor: pending ? "not-allowed" : "pointer" }}
              >
                <span>✕</span>
                {pending ? t("diff.rejecting") : t("diff.cancel")}
              </button>
            </div>
          )}
        </div>
        <div className="bd" style={{ padding: 16 }}>
          {showDiffSection && props.diff ? (
            <DiffViewer lines={props.diff} />
          ) : (
            <p
              style={{
                padding: "22px 16px",
                fontSize: 12.5,
                color: "var(--fg-3)",
                border: "1px dashed var(--border-1)",
                borderRadius: 2,
                textAlign: "center",
              }}
            >
              {t("diff.empty")}
            </p>
          )}
        </div>
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
  if (args.status === ITERATION_IDLE_STATUS) {
    head.push({
      key: "idle",
      kind: "info",
      params: { version: args.baseVersion },
    });
    return head;
  }
  if (args.status === ITERATION_RUNNING_STATUS) {
    head.push({ key: "agentStart", kind: "reading" });
    head.push({ key: "working", kind: "reading" });
    return head;
  }
  if (args.status === ITERATION_PROPOSED_STATUS) {
    head.push({ key: "sessionOpen", kind: "done" });
    head.push({ key: "finishing", kind: "done" });
    head.push({ key: "awaitingReview", kind: "success" });
    return head;
  }
  if (args.status === ITERATION_APPLIED_STATUS) {
    head.push({
      key: "applied",
      kind: "success",
      params: { version: args.appliedVersion ?? args.baseVersion },
    });
    return head;
  }
  if (args.status === ITERATION_REJECTED_STATUS) {
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
