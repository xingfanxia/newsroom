"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  parsePersistedTweaks,
  persistableTweaks,
  resolveTweaks,
  TWEAK_DEFAULTS,
  type Tweaks,
} from "@/lib/tweaks";
import type { AppLocale } from "@/lib/types";

export type { Tweaks };

const STORAGE_KEY = "ax-radar:tweaks";
const TWEAKS_SERVER_SYNC_DEBOUNCE_MS = 500;

type TweaksValue = {
  tweaks: Tweaks;
  setTweaks: (next: Tweaks) => void;
  patch: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
  reset: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
};

const TweaksContext = createContext<TweaksValue | null>(null);

function readStoredTweaks(): Partial<Tweaks> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    // Untrusted persisted blob — validate field-by-field, drop corrupt values.
    return parsePersistedTweaks(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Provider for the site-config tweaks (theme/accent/language/etc).
 * One instance per document. Persists to localStorage, mirrors state onto
 * `<body data-*>` so terminal.css selectors can react.
 *
 * SSR emits the default values on body data-attrs; the provider reconciles
 * to localStorage on mount. This avoids FOUC for users with default config
 * and causes at most one paint flicker for users with non-default saved
 * settings.
 */
export function TweaksProvider({
  children,
  initialLanguage,
}: {
  children: ReactNode;
  initialLanguage?: AppLocale;
}) {
  // Language is the URL `[locale]` segment (single source of truth — the same
  // locale the server used to resolve story titles), passed in as
  // `initialLanguage`. It is NEVER read back from persisted storage, so the
  // chrome can't desync from the feed titles (the "Chinese chrome, English
  // titles" bug). Every other tweak still persists per-browser.
  const urlLanguage: AppLocale = initialLanguage ?? TWEAK_DEFAULTS.language;
  const base: Tweaks = useMemo(() => resolveTweaks(urlLanguage), [urlLanguage]);
  const [tweaks, setTweaksState] = useState<Tweaks>(base);
  const [open, setOpen] = useState(false);
  const pendingServerTweaksRef = useRef<Partial<Tweaks> | null>(null);
  const serverSyncTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const localRaw = readStoredTweaks();
    // `resolveTweaks` forces `language` to the URL locale in every merge, so a
    // persisted language can never win. State starts at `base` (SSR-matching)
    // and reconciles here: server copy on success, localStorage copy otherwise.
    const localTweaks = resolveTweaks(urlLanguage, localRaw);
    let cancelled = false;

    async function loadServerTweaks() {
      try {
        const response = await fetch("/api/tweaks", {
          credentials: "same-origin",
        });
        const body = response.ok ? await response.json() : null;
        if (cancelled) return;
        const server = parsePersistedTweaks(body?.tweaks);
        const merged = resolveTweaks(urlLanguage, localRaw, server);
        setTweaksState(merged);
        try {
          // `language` is URL-derived and never read back — don't persist it.
          const persisted = persistableTweaks(merged);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
        } catch {
          /* ignore */
        }
      } catch {
        // auth_required / network error — fall back to the localStorage copy.
        if (!cancelled) setTweaksState(localTweaks);
      }
    }

    // Start from localStorage, then upgrade with the server's copy if available.
    void loadServerTweaks();
    return () => {
      cancelled = true;
    };
  }, [urlLanguage]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const b = document.body;
    b.setAttribute("data-theme", tweaks.theme);
    b.setAttribute("data-accent", tweaks.accent);
    b.setAttribute("data-mono", tweaks.monoFont);
    b.setAttribute("data-cjk", tweaks.cjkFont);
    b.setAttribute("data-radius", tweaks.radius);
    b.setAttribute("data-chrome", tweaks.chromeStyle);
    b.setAttribute("data-score", tweaks.scoreStyle);
    b.setAttribute("data-density", tweaks.density);
    b.setAttribute("data-linenum", tweaks.showLineNumbers ? "on" : "off");
    b.setAttribute("data-mutedmeta", tweaks.mutedMeta ? "on" : "off");
    // Language is URL-driven — read it straight from `urlLanguage` so a
    // same-page locale switch flips `data-lang` synchronously with the render,
    // not after the async /api/tweaks reconcile resolves.
    b.setAttribute("data-lang", urlLanguage);
  }, [tweaks, urlLanguage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === ",") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (serverSyncTimerRef.current !== null) {
        window.clearTimeout(serverSyncTimerRef.current);
        serverSyncTimerRef.current = null;
      }
      pendingServerTweaksRef.current = null;
    };
  }, []);

  const scheduleServerSync = useCallback((next: Partial<Tweaks>) => {
    pendingServerTweaksRef.current = next;
    if (serverSyncTimerRef.current !== null) {
      window.clearTimeout(serverSyncTimerRef.current);
    }

    serverSyncTimerRef.current = window.setTimeout(() => {
      serverSyncTimerRef.current = null;
      const pending = pendingServerTweaksRef.current;
      pendingServerTweaksRef.current = null;
      if (!pending) return;

      // Fire-and-forget server sync. 401 means anon user — localStorage is
      // sufficient for them. Any error is silent; the local cookie still holds.
      void fetch("/api/tweaks", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tweaks: pending }),
      }).catch(() => {});
    }, TWEAKS_SERVER_SYNC_DEBOUNCE_MS);
  }, []);

  const setTweaks = useCallback(
    (next: Tweaks) => {
      // Language is URL-driven — coerce it on every write so no control can
      // desync the chrome from the URL-locale titles.
      const coerced: Tweaks = { ...next, language: urlLanguage };
      setTweaksState(coerced);
      // Persist / sync everything except the URL-derived language.
      const persisted = persistableTweaks(coerced);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
      } catch {
        /* quota / disabled — still update in-memory + body attrs */
      }
      scheduleServerSync(persisted);
    },
    [scheduleServerSync, urlLanguage],
  );

  const patch = useCallback(
    <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => {
      setTweaks({ ...tweaks, [key]: value });
    },
    [tweaks, setTweaks],
  );

  const reset = useCallback(
    () => setTweaks(resolveTweaks(urlLanguage)),
    [setTweaks, urlLanguage],
  );

  // Expose `language` as a synchronous derivation of the URL locale rather than
  // the async-reconciled state. Without this, a same-page locale switch shows
  // stale chrome (old language) over new-locale titles for the duration of the
  // /api/tweaks fetch. Raw `tweaks` stays the persistence vehicle for every
  // other field; the setTweaks/reset coercions keep raw state's language in
  // sync as belt-and-suspenders.
  const exposedTweaks = useMemo<Tweaks>(
    () => ({ ...tweaks, language: urlLanguage }),
    [tweaks, urlLanguage],
  );

  const value: TweaksValue = {
    tweaks: exposedTweaks,
    setTweaks,
    patch,
    reset,
    open,
    setOpen,
  };

  return (
    <TweaksContext.Provider value={value}>{children}</TweaksContext.Provider>
  );
}

/** Consume tweaks state. Must be used inside <TweaksProvider>. */
export function useTweaks(): TweaksValue {
  const ctx = useContext(TweaksContext);
  if (!ctx) {
    throw new Error("useTweaks called outside <TweaksProvider>");
  }
  return ctx;
}
