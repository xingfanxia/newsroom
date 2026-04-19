"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useTweaks } from "@/hooks/use-tweaks";
import type { SavedCollection } from "@/lib/items/collections";

type Props = {
  locale: "en" | "zh";
  collections: SavedCollection[];
  inboxCount: number;
  activeId: number | "inbox";
};

/**
 * Left-column collection picker. Reads the list from the server, mutates via
 * /api/admin/collections + /api/feedback/move, refreshes the route on success.
 */
export function CollectionSidebar({
  locale,
  collections,
  inboxCount,
  activeId,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { tweaks } = useTweaks();
  const zh = tweaks.language === "zh";

  const go = (id: number | "inbox") => {
    const qs = new URLSearchParams();
    if (id !== "inbox") qs.set("collection", String(id));
    const search = qs.toString();
    const href = `/${locale}/saved${search ? `?${search}` : ""}`;
    start(() => router.push(href));
  };

  const create = async () => {
    const name = prompt(zh ? "新建收藏夹名称" : "new collection name")?.trim();
    if (!name) return;
    const cjk = zh ? name : prompt(zh ? "中文名（可选）" : "CJK name (optional)")?.trim() || null;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, nameCjk: cjk }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(
          body.error === "duplicate_name"
            ? zh ? "已存在同名收藏夹" : "a collection with that name already exists"
            : zh ? "创建失败" : "create failed",
        );
        return;
      }
      toast.success(zh ? "已创建" : "created");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const rename = async (c: SavedCollection) => {
    const next = prompt(zh ? "重命名为" : "rename to", c.name)?.trim();
    if (!next || next === c.name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/collections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, name: next }),
      });
      if (!res.ok) {
        toast.error(zh ? "重命名失败" : "rename failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
      setEditingId(null);
    }
  };

  const togglePin = async (c: SavedCollection) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/collections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, pinned: !c.pinned }),
      });
      if (!res.ok) {
        toast.error(zh ? "操作失败" : "pin failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const del = async (c: SavedCollection) => {
    if (!confirm(zh ? `删除 "${c.name}"？已收藏的条目会移回收件箱` : `delete "${c.name}"? saved items return to inbox`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/collections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id }),
      });
      if (!res.ok) {
        toast.error(zh ? "删除失败" : "delete failed");
        return;
      }
      toast.success(zh ? "已删除" : "deleted");
      // If the active collection is the one being deleted, fall back to inbox.
      if (activeId === c.id) go("inbox");
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || pending;

  return (
    <aside
      className="coll-list"
      style={{ opacity: disabled ? 0.65 : 1, transition: "opacity 150ms" }}
    >
      <div
        className="sec"
        style={{ padding: 0, marginBottom: 6, alignItems: "center" }}
      >
        <span>{zh ? "收藏夹" : "collections"}</span>
        <button
          type="button"
          onClick={create}
          disabled={disabled}
          style={{
            background: "transparent",
            border: "0",
            color: "var(--accent-green)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            cursor: disabled ? "not-allowed" : "pointer",
            letterSpacing: "0.02em",
          }}
        >
          + {zh ? "新建" : "new"}
        </button>
      </div>

      <CollectionRow
        active={activeId === "inbox"}
        label={zh ? "收件箱" : "inbox"}
        count={inboxCount}
        onClick={() => go("inbox")}
        disabled={disabled}
        pinned
      />

      {collections.map((c) => {
        const active = activeId === c.id;
        return (
          <div
            key={c.id}
            onMouseLeave={() => setEditingId(null)}
            style={{ position: "relative" }}
          >
            <CollectionRow
              active={active}
              label={zh ? c.nameCjk || c.name : c.name}
              count={c.count}
              onClick={() => go(c.id)}
              onMenu={() => setEditingId(editingId === c.id ? null : c.id)}
              disabled={disabled}
              pinned={c.pinned}
            />
            {editingId === c.id && (
              <div
                style={{
                  position: "absolute",
                  right: 6,
                  top: "100%",
                  zIndex: 5,
                  marginTop: 2,
                  background: "var(--bg-2)",
                  border: "1px solid var(--border-2)",
                  borderRadius: 2,
                  padding: 4,
                  boxShadow: "var(--shadow-menu)",
                  minWidth: 120,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                }}
              >
                <MenuBtn onClick={() => rename(c)}>
                  ✎ {zh ? "重命名" : "rename"}
                </MenuBtn>
                <MenuBtn onClick={() => togglePin(c)}>
                  {c.pinned ? "▽" : "▲"} {zh ? "置顶" : c.pinned ? "unpin" : "pin"}
                </MenuBtn>
                <MenuBtn danger onClick={() => del(c)}>
                  ✕ {zh ? "删除" : "delete"}
                </MenuBtn>
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}

function CollectionRow({
  active,
  label,
  count,
  onClick,
  onMenu,
  disabled,
  pinned,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  onMenu?: () => void;
  disabled: boolean;
  pinned?: boolean;
}) {
  return (
    <div
      className="watch-row"
      style={{
        cursor: disabled ? "not-allowed" : "pointer",
        padding: "6px 6px",
        background: active ? "var(--tint-white-03)" : "transparent",
        borderLeft: active ? "2px solid var(--accent-green)" : "2px solid transparent",
        paddingLeft: active ? 4 : 6,
        borderBottom: "1px dashed var(--border-1)",
        gap: 6,
      }}
      onClick={(e) => {
        // Don't trigger navigation when clicking the menu dots.
        if ((e.target as HTMLElement).dataset?.menu === "1") return;
        onClick();
      }}
    >
      <span className="sym" style={{ opacity: pinned ? 1 : 0.4 }}>
        ▸
      </span>
      <span className="q" style={{ color: active ? "var(--fg-0)" : "var(--fg-1)" }}>
        {label}
      </span>
      <span className="hits" style={{ color: "var(--fg-3)" }}>
        {count}
      </span>
      {onMenu ? (
        <span
          data-menu="1"
          onClick={(e) => {
            e.stopPropagation();
            onMenu();
          }}
          style={{
            color: "var(--fg-3)",
            fontFamily: "var(--font-mono)",
            cursor: "pointer",
            padding: "0 3px",
            fontSize: 14,
            lineHeight: "14px",
          }}
        >
          ⋯
        </span>
      ) : (
        <span />
      )}
    </div>
  );
}

function MenuBtn({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
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
        color: danger ? "var(--accent-red)" : "var(--fg-1)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        cursor: "pointer",
        borderRadius: 1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-3)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}
