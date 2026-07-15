import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHermeticEnvironment } from "@/scripts/verification/environment-policy";
import {
  assertPublicRuntimeCorpusComplete,
  PUBLIC_RUNTIME_CASES,
} from "@/scripts/verification/public-runtime-corpus";
import {
  startPublicSnapshotFixture,
  type PublicSnapshotFixtureServer,
} from "@/scripts/verification/serve-snapshot-fixture";

const enabled = process.env.PUBLIC_POISON_BUILD_READY === "1";
const integrationTest = enabled ? test : test.skip;
const rootDir = resolve(join(import.meta.dir, "../.."));
setDefaultTimeout(60_000);

let snapshot: PublicSnapshotFixtureServer;
let poison: ReturnType<typeof recordingServer>;
let next: Awaited<ReturnType<typeof startNextServer>>;

beforeAll(async () => {
  if (!enabled) return;
  expect(existsSync(join(rootDir, ".next/server/app-paths-manifest.json"))).toBeTrue();
  snapshot = await startPublicSnapshotFixture();
  poison = recordingServer();
  next = await startNextServer(snapshot.baseUrl, poison.baseUrl);
});

afterAll(async () => {
  if (!enabled) return;
  await next?.stop();
  poison?.stop();
  snapshot?.stop();
});

describe("cold anonymous runtime with poison Turso", () => {
  integrationTest("covers the complete anonymous inventory with GET, HEAD and RSC", async () => {
    expect(assertPublicRuntimeCorpusComplete).not.toThrow();

    for (const runtimeCase of PUBLIC_RUNTIME_CASES) {
      const url = `${next.baseUrl}${runtimeCase.path}`;
      const get = await fetch(url, { redirect: "manual" });
      expect(get.status, `GET ${runtimeCase.path}`).toBe(runtimeCase.expectedStatus);
      expect(get.status, `GET ${runtimeCase.path}`).toBeLessThan(500);
      if (runtimeCase.kind === "page" && get.status === 200) {
        expect(get.headers.get("content-type"), runtimeCase.path).toContain("text/html");
      }

      const head = await fetch(url, { method: "HEAD", redirect: "manual" });
      expect(head.status, `HEAD ${runtimeCase.path}`).toBe(runtimeCase.expectedStatus);
      expect(head.status, `HEAD ${runtimeCase.path}`).toBeLessThan(500);

      if (runtimeCase.kind === "page" && runtimeCase.expectedStatus === 200) {
        const rsc = await fetch(withRscQuery(url), {
          headers: { RSC: "1", "Next-Router-Prefetch": "1" },
          redirect: "manual",
        });
        expect(rsc.status, `RSC ${runtimeCase.path}`).toBe(200);
        expect(rsc.headers.get("content-type"), runtimeCase.path).toContain(
          "text/x-component",
        );
      }
    }

    expect(snapshot.requestPaths.length).toBeGreaterThan(0);
    expect(snapshot.requestPaths).toContain("/newsroom/v1/current.json");
    expect(poison.requests).toHaveLength(0);
  });

  integrationTest("hydrates /all in a real browser without DB or calendar prefetch", async () => {
    const browser = await runBrowserProbe(`${next.baseUrl}/en/all`);
    expect(browser.documentStatus).toBe(200);
    expect(browser.readyState).toBe("complete");
    expect(browser.appChunkRequests).toBeGreaterThan(0);
    expect(browser.serverErrors).toEqual([]);
    expect(browser.requestUrls.some((url) => /\/en\/daily\/\d{4}-\d{2}-\d{2}/.test(url))).toBeFalse();
    expect(poison.requests).toHaveLength(0);
  });
});

function recordingServer() {
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(request.url);
      return new Response("poison Turso endpoint", { status: 503 });
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    requests,
    stop: () => server.stop(true),
  };
}

async function startNextServer(snapshotBaseUrl: string, poisonBaseUrl: string) {
  const port = await availablePort();
  const environment = createHermeticEnvironment({
    inherited: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      USER: process.env.USER,
    },
    overrides: {
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(port),
      R2_PUBLIC_BASE_URL: snapshotBaseUrl,
      TURSO_AUTH_TOKEN: "fake-poison-auth-token",
      TURSO_DATABASE_URL: poisonBaseUrl,
    },
  });
  const child = Bun.spawn(
    [join(rootDir, "node_modules/.bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: rootDir,
      env: environment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(`${baseUrl}/robots.txt`, child);
  } catch (error) {
    child.kill();
    await child.exited;
    throw new Error(
      `${error instanceof Error ? error.message : error}\n${await stdout}\n${await stderr}`,
    );
  }
  return {
    baseUrl,
    async stop() {
      child.kill("SIGTERM");
      await child.exited;
      await Promise.all([stdout, stderr]);
    },
  };
}

async function availablePort(): Promise<number> {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("port probe"),
  });
  const port = server.port;
  server.stop(true);
  if (port === undefined) throw new Error("port probe did not bind a TCP port");
  return port;
}

async function waitForServer(
  url: string,
  child: Bun.Subprocess,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // Server is still starting.
    }
    await delay(100);
  }
  throw new Error("Next did not become ready before the deadline");
}

function withRscQuery(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("_rsc", "poison-runtime");
  return parsed.toString();
}

type CdpMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
};

async function runBrowserProbe(url: string): Promise<{
  appChunkRequests: number;
  documentStatus: number | null;
  readyState: string;
  requestUrls: string[];
  serverErrors: number[];
}> {
  const chromePath =
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);
  const profile = mkdtempSync(join(tmpdir(), "newsroom-poison-chrome-"));
  const debuggingPort = await availablePort();
  const chrome = Bun.spawn(
    [
      chromePath,
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-gpu",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
  );
  let socket: WebSocket | null = null;
  try {
    const target = await waitForChromeTarget(debuggingPort);
    const events: CdpMessage[] = [];
    const pending = new Map<
      number,
      { reject(error: Error): void; resolve(value: unknown): void }
    >();
    let id = 0;
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolveOpen, rejectOpen) => {
      socket!.addEventListener("open", () => resolveOpen(), { once: true });
      socket!.addEventListener("error", () => rejectOpen(new Error("CDP socket failed")), { once: true });
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id !== undefined) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message ?? "CDP command failed"));
        else waiter.resolve(message.result);
      } else {
        events.push(message);
      }
    });
    const command = (method: string, params: Record<string, unknown> = {}) => {
      const commandId = ++id;
      return new Promise<unknown>((resolveCommand, rejectCommand) => {
        pending.set(commandId, { reject: rejectCommand, resolve: resolveCommand });
        socket!.send(JSON.stringify({ id: commandId, method, params }));
      });
    };
    await Promise.all([command("Network.enable"), command("Page.enable")]);
    await command("Page.navigate", { url });
    await waitForCdpEvent(events, "Page.loadEventFired", 20_000);
    await delay(1_500);
    const evaluation = (await command("Runtime.evaluate", {
      expression: "document.readyState",
      returnByValue: true,
    })) as { result?: { value?: string } };
    const requestUrls = events
      .filter(({ method }) => method === "Network.requestWillBeSent")
      .map(({ params }) => ((params?.request as { url?: string } | undefined)?.url ?? ""))
      .filter(Boolean);
    const responses = events
      .filter(({ method }) => method === "Network.responseReceived")
      .map(({ params }) => params?.response as { status?: number; url?: string } | undefined)
      .filter((value): value is { status?: number; url?: string } => value !== undefined);
    const origin = new URL(url).origin;
    return {
      appChunkRequests: requestUrls.filter((value) => value.includes("/_next/static/chunks/")).length,
      documentStatus:
        responses.find((response) => response.url === url)?.status ?? null,
      readyState: evaluation.result?.value ?? "unknown",
      requestUrls,
      serverErrors: responses
        .filter((response) => response.url?.startsWith(origin) && (response.status ?? 0) >= 500)
        .map((response) => response.status as number),
    };
  } finally {
    socket?.close();
    chrome.kill("SIGTERM");
    await chrome.exited;
    rmSync(profile, { recursive: true, force: true });
  }
}

async function waitForChromeTarget(port: number): Promise<{
  webSocketDebuggerUrl: string;
}> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const targets = (await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())) as Array<{
        type?: string;
        webSocketDebuggerUrl?: string;
      }>;
      const page = targets.find(
        (target) => target.type === "page" && target.webSocketDebuggerUrl,
      );
      if (page?.webSocketDebuggerUrl) {
        return { webSocketDebuggerUrl: page.webSocketDebuggerUrl };
      }
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }
  throw new Error("Chrome DevTools endpoint did not become ready");
}

async function waitForCdpEvent(
  events: readonly CdpMessage[],
  method: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (events.some((event) => event.method === method)) return;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${method}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
