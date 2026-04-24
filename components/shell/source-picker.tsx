"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

type SourceRow = {
  id: string;
  name_en: string;
  name_zh: string;
  kind: string;
  group: string;
  locale: string;
};

// Module-level cache — the left rail mounts on every route, but the source
// list is ~global-constant per session. Survives client-side nav.
let sourceCache: SourceRow[] | null = null;
let sourcePromise: Promise<SourceRow[]> | null = null;

function loadSources(): Promise<SourceRow[]> {
  if (sourceCache) return Promise.resolve(sourceCache);
  if (sourcePromise) return sourcePromise;
  sourcePromise = fetch("/api/sources/active", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : { sources: [] }))
    .then((j: { sources?: SourceRow[] }) => {
      sourceCache = j.sources ?? [];
      return sourceCache;
    })
    .catch(() => {
      sourceCache = [];
      return sourceCache;
    })
    .finally(() => {
      sourcePromise = null;
    });
  return sourcePromise;
}

type Props = {
  locale: "en" | "zh";
  lang: "en" | "zh";
};

export function SourcePicker({ locale, lang }: Props) {
  const router = useRouter();
  const pathname = usePathname() ?? `/${locale}`;
  const sp = useSearchParams();
  const activeId = sp.get("source_id") ?? undefined;
  const [, startTransition] = useTransition();
  const [sources, setSources] = useState<SourceRow[]>(sourceCache ?? []);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const zh = lang === "zh";

  useEffect(() => {
    if (sourceCache) return;
    loadSources().then(setSources);
  }, []);

  // Global ⌘K / Ctrl+K focuses the picker.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const active = useMemo(
    () => (activeId ? sources.find((s) => s.id === activeId) : undefined),
    [activeId, sources],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? sources.filter(
          (s) =>
            s.name_en.toLowerCase().includes(q) ||
            s.name_zh.toLowerCase().includes(q) ||
            s.id.toLowerCase().includes(q),
        )
      : sources;
    return list.slice(0, 60);
  }, [query, sources]);

  const navigateToSource = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(sp.toString());
      if (id) next.set("source_id", id);
      else next.delete("source_id");
      // Preset + source_id are mutually exclusive — clearing preset keeps the
      // URL predictable (otherwise "media" preset lingers when you pin a
      // specific publisher).
      next.delete("source");
      const qs = next.toString();
      const target = qs ? `${pathname}?${qs}` : pathname;
      startTransition(() => router.push(target));
    },
    [pathname, router, sp],
  );

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      const pick = matches[highlight];
      if (pick) {
        setOpen(false);
        setQuery("");
        navigateToSource(pick.id);
      }
    }
  }

  return (
    <div ref={containerRef} className="source-picker">
      {active && (
        <div className="source-active" title={`${active.name_en} · ${active.id}`}>
          <span className="dot-marker" style={{ background: "var(--accent-blue)" }} />
          <span className="source-active-name">
            {zh ? active.name_zh : active.name_en}
          </span>
          <button
            type="button"
            className="source-active-clear"
            onClick={() => navigateToSource(null)}
            aria-label={zh ? "清除信源筛选" : "clear source filter"}
          >
            ×
          </button>
        </div>
      )}
      <div className={`search ${open ? "on" : ""}`}>
        <span className="prompt-dollar">$</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKeyDown}
          placeholder={zh ? "搜索信源…" : "grep sources…"}
          aria-label={zh ? "搜索信源" : "search sources"}
          spellCheck={false}
          autoComplete="off"
        />
        <kbd>⌘K</kbd>
      </div>
      {open && matches.length > 0 && (
        <div className="source-dropdown scroll-dark" role="listbox">
          {matches.map((s, i) => {
            const primary = zh ? s.name_zh : s.name_en;
            const secondary = zh ? s.name_en : s.name_zh;
            return (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={`source-row ${i === highlight ? "on" : ""}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                  navigateToSource(s.id);
                }}
              >
                <span className="source-row-primary">{primary}</span>
                {secondary && secondary !== primary && (
                  <span className="source-row-secondary">{secondary}</span>
                )}
                <span className="source-row-badge">{s.group}</span>
              </button>
            );
          })}
        </div>
      )}
      {open && query && matches.length === 0 && (
        <div className="source-dropdown source-dropdown-empty">
          {zh ? "没有匹配的信源" : "no matching sources"}
        </div>
      )}
    </div>
  );
}
