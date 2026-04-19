"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { VersionPill } from "@/components/admin/version-pill";
import { useTweaks } from "@/hooks/use-tweaks";

/**
 * Editable policy view. Idle = rendered as preformatted markdown; "edit"
 * button swaps to a split textarea + live preview. Saving calls
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
  const dirty = content !== initialContent;
  const charCount = useMemo(() => content.length, [content]);

  const save = async () => {
    if (!dirty) {
      toast.info(zh ? "没有改动" : "nothing to save");
      return;
    }
    if (!confirm(zh ? `确定发布为 v${version + 1}？` : `commit as v${version + 1}?`)) {
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
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (dirty && !confirm(zh ? "放弃改动？" : "discard changes?")) return;
    setContent(initialContent);
    setReasoning("");
    setEditing(false);
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
              onClick={save}
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
            onChange={(e) => setContent(e.target.value)}
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
          <pre
            style={{
              background: "var(--bg-1)",
              border: "1px solid var(--border-1)",
              color: "var(--fg-1)",
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              lineHeight: 1.7,
              padding: 14,
              whiteSpace: "pre-wrap",
              overflow: "auto",
              borderRadius: 2,
              margin: 0,
            }}
          >
            {content}
          </pre>
        </div>
      ) : (
        <pre
          style={{
            background: "var(--bg-1)",
            border: "1px solid var(--border-1)",
            padding: 20,
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            lineHeight: 1.75,
            color: "var(--fg-1)",
            whiteSpace: "pre-wrap",
            overflowX: "auto",
            borderRadius: 2,
          }}
        >
          {content}
        </pre>
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
            onChange={(e) => setReasoning(e.target.value)}
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
