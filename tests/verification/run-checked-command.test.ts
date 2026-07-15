import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { runCheckedCommand } from "@/scripts/verification/run-checked-command";

const fixture = fileURLToPath(
  new URL("../fixtures/verification/exit-zero-failure.ts", import.meta.url),
);
const hangFixture = fileURLToPath(
  new URL("../fixtures/verification/hang.ts", import.meta.url),
);
const completionSentinel = "__CHECKED_COMMAND_COMPLETE__";

function fixtureCommand(mode: string): [string, string, string] {
  return [process.execPath, fixture, mode];
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    ) {
      return false;
    }
    throw error;
  }
}

async function waitForProcessExit(pid: number, deadlineMs: number): Promise<boolean> {
  const deadline = performance.now() + deadlineMs;
  while (processIsAlive(pid)) {
    if (performance.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  return true;
}

function forceKillIfAlive(pid: number): void {
  if (!processIsAlive(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ESRCH"
    ) {
      throw error;
    }
  }
}

describe("checked command", () => {
  test("accepts exit zero only when the completion sentinel is present", async () => {
    const result = await runCheckedCommand({
      command: fixtureCommand("success"),
      completionSentinel,
      deadlineMs: 1_000,
    });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.reason).toBe("success");
  });

  test.each([
    ["fail-output", "failure-output"],
    ["timeout-output", "failure-output"],
    ["ansi-fail-output", "failure-output"],
    ["ansi-timeout-output", "failure-output"],
  ] as const)(
    "turns exit-zero %s into a nonzero result",
    async (mode, reason) => {
      const result = await runCheckedCommand({
        command: fixtureCommand(mode),
        completionSentinel,
        deadlineMs: 1_000,
      });

      expect(result.processExitCode).toBe(0);
      expect(result.ok).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.reason).toBe(reason);
    },
  );

  test("turns a missing completion sentinel into a nonzero result", async () => {
    const result = await runCheckedCommand({
      command: fixtureCommand("missing-sentinel"),
      completionSentinel,
      deadlineMs: 1_000,
    });

    expect(result.processExitCode).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.reason).toBe("missing-sentinel");
  });

  test("preserves a real nonzero exit as failure", async () => {
    const result = await runCheckedCommand({
      command: fixtureCommand("nonzero"),
      completionSentinel,
      deadlineMs: 1_000,
    });

    expect(result.processExitCode).toBe(7);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(7);
    expect(result.reason).toBe("nonzero-exit");
  });

  test("terminates a hung child at the controller deadline", async () => {
    const startedAt = performance.now();
    const result = await runCheckedCommand({
      command: [process.execPath, hangFixture],
      completionSentinel,
      deadlineMs: 75,
      killGraceMs: 25,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.reason).toBe("deadline-exceeded");
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  test("terminates a stubborn descendant in the isolated Unix process group", async () => {
    if (process.platform === "win32") return;

    let descendantPid: number | undefined;
    try {
      const result = await runCheckedCommand({
        command: [process.execPath, hangFixture, "spawn-descendant"],
        completionSentinel,
        deadlineMs: 75,
        killGraceMs: 25,
      });
      const match = /descendant-pid=(\d+)/.exec(result.stdout);
      expect(match).not.toBeNull();
      descendantPid = Number(match?.[1]);

      expect(result.reason).toBe("deadline-exceeded");
      expect(descendantPid).toBeGreaterThan(0);
      expect(await waitForProcessExit(descendantPid, 1_000)).toBe(true);
    } finally {
      if (descendantPid !== undefined) forceKillIfAlive(descendantPid);
    }
  });

  test("redacts safe fixture credentials if a child renders them", async () => {
    const secret = "test-do-not-render-this-secret";
    const result = await runCheckedCommand({
      command: fixtureCommand("echo-r2-secret"),
      completionSentinel,
      deadlineMs: 1_000,
      env: { R2_SECRET_ACCESS_KEY: secret },
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).not.toContain(secret);
    expect(result.stdout).toContain("secret=[REDACTED]");
  });
});
