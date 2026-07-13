import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TweaksProvider, useTweaks } from "@/hooks/use-tweaks";
import type { Tweaks } from "@/lib/tweaks";

// Mirror of the private STORAGE_KEY in hooks/use-tweaks.tsx.
const STORAGE_KEY = "ax-radar:tweaks";

// The other ~1000 suites run without a DOM; register happy-dom only for this
// file (and tear it down after) so their `typeof window === "undefined"`
// server-context branches are unaffected.
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

afterAll(() => {
  GlobalRegistrator.unregister();
  // happy-dom's unregister restores the DOM globals, but the act-env flag was
  // set by us — clear it so a later React suite in the same bun process doesn't
  // silently inherit act mode.
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

const originalFetch = globalThis.fetch;
let captured: ReturnType<typeof useTweaks> | null = null;
let root: Root | null = null;
let container: HTMLElement | null = null;

type FetchCall = { url: string; method: string; body: unknown };
type FetchInit = { method?: string; body?: string };
let fetchCalls: FetchCall[] = [];

function recordCall(input: unknown, init?: FetchInit) {
  let body: unknown;
  if (init?.body) {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = init.body;
    }
  }
  fetchCalls.push({ url: String(input), method: init?.method ?? "GET", body });
}

function Capture() {
  const value = useTweaks();
  // Publish to the module scope from the effect phase (not during render) so
  // the react-hooks purity rules stay happy; act() flushes this on each commit.
  useEffect(() => {
    captured = value;
  });
  return null;
}

function stubFetch(getResponse: () => Promise<{ tweaks?: Partial<Tweaks> }>) {
  globalThis.fetch = (async (input: unknown, init?: FetchInit) => {
    recordCall(input, init);
    return { ok: true, json: async () => getResponse() };
  }) as unknown as typeof fetch;
}

function stubFetchReject() {
  globalThis.fetch = (async (input: unknown, init?: FetchInit) => {
    recordCall(input, init);
    throw new Error("network down");
  }) as unknown as typeof fetch;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderProvider(initialLanguage: "zh" | "en") {
  const node = document.createElement("div");
  container = node;
  document.body.appendChild(node);
  await act(async () => {
    root = createRoot(node);
    root.render(
      <TweaksProvider initialLanguage={initialLanguage}>
        <Capture />
      </TweaksProvider>,
    );
  });
  await flush();
}

function readStoredPayload(): Record<string, unknown> {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

beforeEach(() => {
  window.localStorage.clear();
  captured = null;
  fetchCalls = [];
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
    root = null;
  }
  container?.remove(); // detach the mount node so containers don't accumulate
  container = null;
  globalThis.fetch = originalFetch;
});

describe("TweaksProvider — URL locale is the single language source", () => {
  it("forces language to the URL locale even when storage disagrees", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ language: "zh", theme: "paper" }),
    );
    stubFetchReject(); // no server copy — reconcile from localStorage only

    await renderProvider("en");

    expect(captured?.tweaks.language).toBe("en"); // URL wins over stored "zh"
    expect(captured?.tweaks.theme).toBe("paper"); // non-language stored applied
    expect(document.body.getAttribute("data-lang")).toBe("en");
  });

  it("merges server over local (last-wins), language still the URL locale", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ accent: "blue", density: "comfy" }),
    );
    stubFetch(async () => ({ tweaks: { accent: "red", language: "zh" } }));

    await renderProvider("zh");

    expect(captured?.tweaks.accent).toBe("red"); // server wins
    expect(captured?.tweaks.density).toBe("comfy"); // local kept
    expect(captured?.tweaks.language).toBe("zh"); // URL locale, not stored
  });

  it("never persists the URL-derived language back to localStorage", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ theme: "slate" }),
    );
    stubFetch(async () => ({ tweaks: {} }));

    await renderProvider("zh");

    const stored = readStoredPayload();
    expect("language" in stored).toBe(false);
    expect(stored.theme).toBe("slate");
  });

  it("setTweaks coerces language to the URL locale and strips it from storage", async () => {
    stubFetch(async () => ({ tweaks: {} }));
    await renderProvider("en");

    await act(async () => {
      captured?.setTweaks({
        ...captured.tweaks,
        theme: "obsidian",
        language: "zh",
      });
    });

    expect(captured?.tweaks.language).toBe("en"); // coerced back to URL locale
    expect(captured?.tweaks.theme).toBe("obsidian");
    const stored = readStoredPayload();
    expect("language" in stored).toBe(false);
    expect(stored.theme).toBe("obsidian");
  });

  it("syncs a partial without language in the server PATCH body", async () => {
    stubFetch(async () => ({ tweaks: {} }));
    await renderProvider("en");
    fetchCalls = []; // drop the mount GET; only inspect the write below

    await act(async () => {
      captured?.setTweaks({
        ...captured.tweaks,
        theme: "obsidian",
        language: "zh",
      });
    });
    // Let the 500ms server-sync debounce fire (real timer under happy-dom).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    const patch = fetchCalls.find((call) => call.method === "PATCH");
    expect(patch).toBeDefined();
    const body = patch?.body as { tweaks?: Record<string, unknown> } | undefined;
    expect(body?.tweaks?.theme).toBe("obsidian");
    expect(body?.tweaks && "language" in body.tweaks).toBe(false);
  });
});
