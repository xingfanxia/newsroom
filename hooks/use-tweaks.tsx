"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Tweaks = {
  density: "compact" | "comfy" | "reader";
  accent: "green" | "blue" | "purple" | "orange" | "red" | "cyan";
  theme: "midnight" | "obsidian" | "slate" | "paper";
  monoFont: "jetbrains" | "ibm" | "iosevka" | "system";
  cjkFont: "notoSerif" | "notoSans" | "lxgw";
  radius: "sharp" | "subtle" | "soft" | "pill";
  chromeStyle: "terminal" | "clean" | "brutalist";
  scoreStyle: "ring" | "bar" | "tag" | "none";
  showTicker: boolean;
  showRadar: boolean;
  showPulse: boolean;
  showBreadcrumb: boolean;
  showLineNumbers: boolean;
  mutedMeta: boolean;
  language: "zh" | "en";
};

export const TWEAK_DEFAULTS: Tweaks = {
  density: "compact",
  accent: "green",
  theme: "midnight",
  monoFont: "jetbrains",
  cjkFont: "notoSerif",
  radius: "sharp",
  chromeStyle: "terminal",
  scoreStyle: "ring",
  showTicker: true,
  showRadar: true,
  showPulse: true,
  showBreadcrumb: true,
  showLineNumbers: false,
  mutedMeta: true,
  language: "en",
};

const STORAGE_KEY = "ax-radar:tweaks";

type TweaksValue = {
  tweaks: Tweaks;
  setTweaks: (next: Tweaks) => void;
  patch: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
  reset: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
};

const TweaksContext = createContext<TweaksValue | null>(null);

function loadFromStorage(fallback: Tweaks): Tweaks {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Migrate legacy "both" language value to "en" (binary mode only).
    if (parsed.language === "both") parsed.language = "en";
    return { ...fallback, ...(parsed as Partial<Tweaks>) };
  } catch {
    return fallback;
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
  initialLanguage?: "zh" | "en";
}) {
  const base: Tweaks = useMemo(
    () => ({
      ...TWEAK_DEFAULTS,
      ...(initialLanguage ? { language: initialLanguage } : {}),
    }),
    [initialLanguage],
  );
  const [tweaks, setTweaksState] = useState<Tweaks>(base);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Start from localStorage for instant paint (zero network), then upgrade
    // with the server's copy if available — server wins when the user has
    // saved tweaks on another device and signed in here fresh.
    const local = loadFromStorage(base);
    setTweaksState(local);
    let cancelled = false;
    fetch("/api/tweaks", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body?.tweaks) return;
        const server = body.tweaks as Record<string, unknown>;
        if (server.language === "both") server.language = "en";
        const merged: Tweaks = { ...local, ...(server as Partial<Tweaks>) };
        setTweaksState(merged);
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        // auth_required / network error — localStorage is still applied.
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

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
    b.setAttribute("data-lang", tweaks.language);
  }, [tweaks]);

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

  const setTweaks = useCallback((next: Tweaks) => {
    setTweaksState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* quota / disabled — still update in-memory + body attrs */
    }
    // Fire-and-forget server sync. 401 means anon user — localStorage is
    // sufficient for them. Any error is silent; the local cookie still holds.
    void fetch("/api/tweaks", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tweaks: next }),
    }).catch(() => {});
  }, []);

  const patch = useCallback(
    <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => {
      setTweaks({ ...tweaks, [key]: value });
    },
    [tweaks, setTweaks],
  );

  const reset = useCallback(() => setTweaks(TWEAK_DEFAULTS), [setTweaks]);

  const value: TweaksValue = {
    tweaks,
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
