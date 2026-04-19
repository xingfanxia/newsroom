"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useTweaks } from "@/hooks/use-tweaks";
import type { SavedCollection } from "@/lib/items/collections";

type Props = {
  itemId: number;
  itemUrl: string;
  savedAt: string;
  currentCollectionId: number | null;
  collections: SavedCollection[];
};

function formatRel(iso: string, zh: boolean): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diffMin = Math.max(0, Math.round((now - t) / 60_000));
  if (diffMin < 1) return zh ? "刚刚" : "just now";
  if (diffMin < 60) return zh ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return zh ? `${diffH} 小时前` : `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  return zh ? `${diffD} 天前` : `${diffD}d ago`;
}

/**
 * Row of metadata + actions rendered ABOVE each saved item. Keeps the HKR
 * ring in the item-body unobstructed (cf. s4 of the handoff chat where the
 * design originally overlapped the ring).
 */
export function SavedMetaStrip({
  itemId,
  itemUrl,
  savedAt,
  currentCollectionId,
  collections,
}: Props) {
  const router = useRouter();
  const { tweaks } = useTweaks();
  const zh = tweaks.language === "zh";
  const [moveOpen, setMoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const currentCollection =
    currentCollectionId != null
      ? collections.find((c) => c.id === currentCollectionId)
      : null;
  const tag = currentCollection
    ? (zh ? currentCollection.nameCjk || currentCollection.name : currentCollection.name)
    : zh ? "收件箱" : "inbox";

  const move = async (targetId: number | null) => {
    setBusy(true);
    try {
      const res = await fetch("/api/feedback/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, targetCollectionId: targetId }),
      });
      if (!res.ok) {
        toast.error(zh ? "移动失败" : "move failed");
        return;
      }
      toast.success(zh ? "已移动" : "moved");
      router.refresh();
    } finally {
      setBusy(false);
      setMoveOpen(false);
    }
  };

  const remove = async () => {
    if (!confirm(zh ? "取消收藏？" : "remove from saved?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, vote: "save", on: false }),
      });
      if (!res.ok) {
        toast.error(zh ? "取消失败" : "remove failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="saved-meta"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 4px 8px",
        fontSize: 10.5,
        color: "var(--fg-3)",
        fontFamily: "var(--font-mono)",
        borderBottom: "1px dashed var(--border-1)",
        marginBottom: 8,
        flexWrap: "wrap",
        opacity: busy ? 0.6 : 1,
        position: "relative",
      }}
    >
      <span className="sv-when">
        {zh ? "保存于" : "saved"} {formatRel(savedAt, zh)}
      </span>
      <span style={{ color: "var(--border-2)" }}>·</span>
      <span
        style={{
          color: currentCollection ? "var(--accent-green)" : "var(--fg-2)",
          background: currentCollection ? "rgba(63,185,80,0.06)" : "var(--bg-2)",
          padding: "1px 6px",
          borderRadius: 2,
        }}
      >
        #{tag}
      </span>

      <span style={{ flex: 1 }} />

      <a
        href={itemUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{
          color: "var(--fg-2)",
          textDecoration: "none",
          borderBottom: "1px dotted var(--border-2)",
        }}
      >
        ↗ {zh ? "打开" : "open"}
      </a>

      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          setMoveOpen((o) => !o);
        }}
        style={{
          background: "transparent",
          border: "0",
          color: "var(--fg-2)",
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        ⇢ {zh ? "移动" : "move"}
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          remove();
        }}
        style={{
          background: "transparent",
          border: "0",
          color: "var(--accent-red)",
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        ✕ {zh ? "取消收藏" : "remove"}
      </button>

      {moveOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            zIndex: 6,
            marginTop: 2,
            background: "var(--bg-2)",
            border: "1px solid var(--border-2)",
            borderRadius: 2,
            padding: 4,
            boxShadow: "var(--shadow-menu)",
            minWidth: 160,
          }}
        >
          {currentCollectionId != null && (
            <MoveBtn onClick={() => move(null)}>
              ↩ {zh ? "移到收件箱" : "to inbox"}
            </MoveBtn>
          )}
          {collections
            .filter((c) => c.id !== currentCollectionId)
            .map((c) => (
              <MoveBtn key={c.id} onClick={() => move(c.id)}>
                → {zh ? c.nameCjk || c.name : c.name}
              </MoveBtn>
            ))}
          {collections.length === 0 && (
            <div
              style={{
                padding: "6px 8px",
                fontSize: 10,
                color: "var(--fg-3)",
                fontStyle: "italic",
              }}
            >
              {zh ? "还没有其它收藏夹" : "no other collections"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MoveBtn({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "6px 8px",
        background: "transparent",
        border: "0",
        color: "var(--fg-1)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-3)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}
