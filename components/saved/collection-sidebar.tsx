"use client";
import { useRouter } from "next/navigation";
import {
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useTweaks } from "@/hooks/use-tweaks";
import type { SavedCollection } from "@/lib/items/collections";

type Props = {
  locale: "en" | "zh";
  collections: SavedCollection[];
  inboxCount: number;
  activeId: number | "inbox";
};

type CollectionFormState =
  | {
      mode: "create";
      name: string;
      nameCjk: string;
    }
  | {
      mode: "rename";
      collection: SavedCollection;
      name: string;
      nameCjk: string;
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
  const [form, setForm] = useState<CollectionFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedCollection | null>(null);
  const { tweaks } = useTweaks();
  const zh = tweaks.language === "zh";

  const go = (id: number | "inbox") => {
    const qs = new URLSearchParams();
    if (id !== "inbox") qs.set("collection", String(id));
    const search = qs.toString();
    const href = `/${locale}/saved${search ? `?${search}` : ""}`;
    start(() => router.push(href));
  };

  const openCreate = () => {
    setEditingId(null);
    setDeleteTarget(null);
    setForm({ mode: "create", name: "", nameCjk: "" });
  };

  const openRename = (collection: SavedCollection) => {
    setEditingId(null);
    setDeleteTarget(null);
    setForm({
      mode: "rename",
      collection,
      name: collection.name,
      nameCjk: collection.nameCjk ?? "",
    });
  };

  const updateForm = (patch: Partial<Pick<CollectionFormState, "name" | "nameCjk">>) => {
    setForm((current) => (current ? { ...current, ...patch } : current));
  };

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;

    const name = form.name.trim();
    if (!name) {
      toast.error(zh ? "请输入收藏夹名称" : "collection name required");
      return;
    }

    setBusy(true);
    try {
      const isRename = form.mode === "rename";
      const res = await fetch("/api/admin/collections", {
        method: isRename ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isRename
            ? {
                id: form.collection.id,
                name,
                nameCjk: form.nameCjk.trim(),
              }
            : {
                name,
                nameCjk: form.nameCjk.trim() || (zh ? name : null),
              },
        ),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(
          body.error === "duplicate_name"
            ? zh ? "已存在同名收藏夹" : "a collection with that name already exists"
            : isRename
              ? zh ? "重命名失败" : "rename failed"
              : zh ? "创建失败" : "create failed",
        );
        return;
      }
      toast.success(
        isRename ? (zh ? "已重命名" : "renamed") : (zh ? "已创建" : "created"),
      );
      setForm(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const requestDelete = (collection: SavedCollection) => {
    setEditingId(null);
    setForm(null);
    setDeleteTarget(collection);
  };

  const togglePin = async (c: SavedCollection) => {
    setForm(null);
    setDeleteTarget(null);
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

  const deleteCollection = async (c: SavedCollection) => {
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
      setDeleteTarget(null);
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
          onClick={openCreate}
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

      {form && (
        <CollectionFormPanel
          form={form}
          zh={zh}
          disabled={disabled}
          onChange={updateForm}
          onCancel={() => setForm(null)}
          onSubmit={submitForm}
        />
      )}

      {collections.map((c) => {
        const active = activeId === c.id;
        return (
          <div
            key={c.id}
            style={{ marginBottom: editingId === c.id || deleteTarget?.id === c.id ? 6 : 0 }}
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
              <CollectionMenuPanel>
                <MenuBtn onClick={() => openRename(c)}>
                  ✎ {zh ? "重命名" : "rename"}
                </MenuBtn>
                <MenuBtn onClick={() => togglePin(c)}>
                  {c.pinned ? "▽" : "▲"} {zh ? "置顶" : c.pinned ? "unpin" : "pin"}
                </MenuBtn>
                <MenuBtn danger onClick={() => requestDelete(c)}>
                  ✕ {zh ? "删除" : "delete"}
                </MenuBtn>
              </CollectionMenuPanel>
            )}
            {deleteTarget?.id === c.id && (
              <DeleteCollectionPanel
                collection={c}
                zh={zh}
                disabled={disabled}
                onCancel={() => setDeleteTarget(null)}
                onConfirm={() => deleteCollection(c)}
              />
            )}
          </div>
        );
      })}
    </aside>
  );
}

function CollectionFormPanel({
  form,
  zh,
  disabled,
  onChange,
  onCancel,
  onSubmit,
}: {
  form: CollectionFormState;
  zh: boolean;
  disabled: boolean;
  onChange: (patch: Partial<Pick<CollectionFormState, "name" | "nameCjk">>) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isRename = form.mode === "rename";
  return (
    <form
      onSubmit={onSubmit}
      style={{
        margin: "8px 0",
        padding: 8,
        background: "var(--bg-2)",
        border: "1px solid var(--border-2)",
        borderRadius: 2,
        display: "grid",
        gap: 7,
        fontFamily: "var(--font-mono)",
      }}
    >
      <div style={{ fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase" }}>
        {isRename ? (zh ? "重命名收藏夹" : "rename collection") : (zh ? "新建收藏夹" : "new collection")}
      </div>
      <CollectionInput
        value={form.name}
        placeholder={zh ? "名称" : "name"}
        disabled={disabled}
        autoFocus
        onChange={(name) => onChange({ name })}
      />
      <CollectionInput
        value={form.nameCjk}
        placeholder={zh ? "中文名（可选）" : "CJK name (optional)"}
        disabled={disabled}
        onChange={(nameCjk) => onChange({ nameCjk })}
      />
      <div style={{ display: "flex", gap: 6 }}>
        <PanelBtn type="submit" disabled={disabled} primary>
          {isRename ? (zh ? "保存" : "save") : (zh ? "创建" : "create")}
        </PanelBtn>
        <PanelBtn type="button" disabled={disabled} onClick={onCancel}>
          {zh ? "取消" : "cancel"}
        </PanelBtn>
      </div>
    </form>
  );
}

function CollectionInput({
  value,
  placeholder,
  disabled,
  autoFocus,
  onChange,
}: {
  value: string;
  placeholder: string;
  disabled: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      maxLength={64}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        boxSizing: "border-box",
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
        color: "var(--fg-1)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        padding: "7px 8px",
        outline: "none",
        borderRadius: 2,
      }}
    />
  );
}

function CollectionMenuPanel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        margin: "2px 0 4px 18px",
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
      {children}
    </div>
  );
}

function DeleteCollectionPanel({
  collection,
  zh,
  disabled,
  onCancel,
  onConfirm,
}: {
  collection: SavedCollection;
  zh: boolean;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      style={{
        margin: "2px 0 6px 18px",
        padding: 8,
        background: "rgba(248,81,73,0.08)",
        border: "1px solid rgba(248,81,73,0.28)",
        borderRadius: 2,
        color: "var(--fg-1)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div style={{ marginBottom: 7 }}>
        {zh
          ? `删除 "${collection.nameCjk || collection.name}"？已收藏条目会回到收件箱。`
          : `Delete "${collection.name}"? Saved items return to inbox.`}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <PanelBtn type="button" disabled={disabled} danger onClick={onConfirm}>
          {zh ? "删除" : "delete"}
        </PanelBtn>
        <PanelBtn type="button" disabled={disabled} onClick={onCancel}>
          {zh ? "取消" : "cancel"}
        </PanelBtn>
      </div>
    </div>
  );
}

function PanelBtn({
  children,
  type,
  disabled,
  primary,
  danger,
  onClick,
}: {
  children: ReactNode;
  type: "button" | "submit";
  disabled: boolean;
  primary?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        background: primary
          ? "rgba(63,185,80,0.16)"
          : danger
            ? "rgba(248,81,73,0.14)"
            : "var(--bg-1)",
        border: `1px solid ${
          primary
            ? "rgba(63,185,80,0.35)"
            : danger
              ? "rgba(248,81,73,0.35)"
              : "var(--border-1)"
        }`,
        color: danger ? "var(--accent-red)" : primary ? "var(--accent-green)" : "var(--fg-2)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        padding: "5px 8px",
        borderRadius: 2,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
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
