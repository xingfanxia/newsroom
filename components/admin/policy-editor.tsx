"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DiffViewer } from "@/components/admin/diff-viewer";
import { AdminMonoBlock } from "@/components/admin/mono-block";
import { VersionPill } from "@/components/admin/version-pill";
import { useTweaks } from "@/hooks/use-tweaks";
import { diffLines } from "@/lib/policy/diff";

type PolicyConfirmAction = "commit" | "discard";

/**
 * Editable policy view. Idle = rendered as preformatted markdown; "edit"
 * button swaps to a split textarea + diff preview. Saving calls
 * /api/admin/policy/commit which writes a new `policy_versions` row and
 * refreshes the route.
 */
export function PolicyEditor({
  skillName,
  initialContent,
  version,
}: {
  skillName: string;
  initialContent: string;
  version: number;
}) {
  const router = useRouter();
  const { tweaks } = useTweaks();
  const zh = tweaks.language === "zh";
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(initialContent);
  const [reasoning, setReasoning] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmAction, setConfirmAction] =
    useState<PolicyConfirmAction | null>(null);
  const dirty = content !== initialContent;
  const activeConfirmAction = dirty ? confirmAction : null;
  const charCount = useMemo(() => content.length, [content]);
  const diff = useMemo(
    () => (dirty ? diffLines(initialContent, content) : []),
    [content, dirty, initialContent],
  );

  const editContent = (nextContent: string) => {
    setContent(nextContent);
    setConfirmAction(null);
  };

  const editReasoning = (nextReasoning: string) => {
    setReasoning(nextReasoning);
    setConfirmAction(null);
  };

  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const requestSave = () => {
    if (!dirty) {
      toast.info(zh ? "没有改动" : "nothing to save");
      return;
    }
    setConfirmAction("commit");
  };

  const confirmPolicyCommit = async () => {
    if (!dirty) {
      setConfirmAction(null);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/policy/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillName,
          content,
          reasoning: reasoning.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(zh ? "保存失败" : "save failed");
        console.error("commit policy failed", body);
        return;
      }
      toast.success(zh ? `已发布 v${body.version}` : `committed v${body.version}`);
      setEditing(false);
      setReasoning("");
      setConfirmAction(null);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const confirmPolicyDiscard = () => {
    setContent(initialContent);
    setReasoning("");
    setConfirmAction(null);
    setEditing(false);
  };

  const cancel = () => {
    if (dirty) {
      setConfirmAction("discard");
      return;
    }
    confirmPolicyDiscard();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          paddingBottom: 10,
          borderBottom: "1px dashed var(--border-1)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
      >
        <VersionPill version={`v${version}`} />
        <span style={{ color: "var(--fg-3)", fontSize: 10.5 }}>
          {charCount.toLocaleString()} chars
        </span>
        <span style={{ flex: 1 }} />
        {editing ? (
          <>
            <button
              type="button"
              className="act-btn primary"
              onClick={requestSave}
              disabled={saving || !dirty}
              style={{ cursor: saving || !dirty ? "not-allowed" : "pointer" }}
            >
              <span>✓</span> {saving ? (zh ? "保存中…" : "saving…") : zh ? `发布为 v${version + 1}` : `commit v${version + 1}`}
            </button>
            <button
              type="button"
              className="act-btn"
              onClick={cancel}
              disabled={saving}
            >
              <span>✕</span> {zh ? "取消" : "cancel"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="act-btn primary"
            onClick={() => setEditing(true)}
          >
            <span>✎</span> {zh ? "编辑" : "edit"}
          </button>
        )}
      </div>

      {editing && activeConfirmAction && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            justifyContent: "space-between",
            border: "1px solid var(--border-1)",
            borderLeft: "2px solid var(--accent-orange)",
            background: "color-mix(in srgb, var(--bg-1) 88%, var(--accent-orange) 12%)",
            padding: "10px 12px",
            fontFamily: "var(--font-mono)",
            borderRadius: 2,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                color: "var(--fg-1)",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {activeConfirmAction === "commit"
                ? zh
                  ? `发布为 v${version + 1}`
                  : `commit v${version + 1}`
                : zh
                  ? "放弃改动"
                  : "discard changes"}
            </span>
            <span style={{ color: "var(--fg-3)", fontSize: 11 }}>
              {activeConfirmAction === "commit"
                ? zh
                  ? "确认后会写入新的策略版本。"
                  : "Confirm to write a new policy version."
                : zh
                  ? "确认后会丢弃当前草稿。"
                  : "Confirm to discard the current draft."}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="act-btn primary"
              onClick={
                activeConfirmAction === "commit"
                  ? confirmPolicyCommit
                  : confirmPolicyDiscard
              }
              disabled={saving}
            >
              <span>✓</span> {zh ? "确认" : "confirm"}
            </button>
            <button
              type="button"
              className="act-btn"
              onClick={() => setConfirmAction(null)}
              disabled={saving}
            >
              <span>✕</span> {zh ? "返回" : "back"}
            </button>
          </div>
        </div>
      )}

      {editing ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            minHeight: 480,
          }}
        >
          <textarea
            value={content}
            onChange={(e) => editContent(e.target.value)}
            spellCheck={false}
            style={{
              background: "var(--bg-1)",
              border: "1px solid var(--border-1)",
              color: "var(--fg-1)",
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              lineHeight: 1.7,
              padding: 14,
              resize: "vertical",
              minHeight: 480,
              outline: "none",
              borderRadius: 2,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "var(--fg-3)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {zh ? "改动预览" : "diff preview"}
            </div>
            {dirty ? (
              <DiffViewer lines={diff} />
            ) : (
              <AdminMonoBlock
                style={{
                  lineHeight: 1.7,
                  padding: 14,
                  overflow: "auto",
                  margin: 0,
                }}
              >
                {content}
              </AdminMonoBlock>
            )}
          </div>
        </div>
      ) : (
        <AdminMonoBlock
          style={{
            overflowX: "auto",
          }}
        >
          {content}
        </AdminMonoBlock>
      )}

      {editing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--fg-3)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {zh ? "本次改动说明（可选）" : "commit reasoning (optional)"}
          </div>
          <input
            value={reasoning}
            onChange={(e) => editReasoning(e.target.value)}
            maxLength={2000}
            placeholder={zh ? "例如：收紧 P1 门槛" : "e.g. tighten P1 threshold"}
            style={{
              background: "var(--bg-1)",
              border: "1px solid var(--border-1)",
              color: "var(--fg-1)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              padding: "8px 10px",
              outline: "none",
              borderRadius: 2,
            }}
          />
        </div>
      )}
    </div>
  );
}
