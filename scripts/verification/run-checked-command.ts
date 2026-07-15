import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  EnvironmentPolicyError,
  createHermeticEnvironment,
  redactSecretValues,
  type EnvironmentInput,
} from "./environment-policy";

export type CheckedCommandReason =
  | "success"
  | "deadline-exceeded"
  | "failure-output"
  | "missing-sentinel"
  | "nonzero-exit"
  | "spawn-error";

export interface CheckedCommandOptions {
  command: readonly [string, ...string[]];
  completionSentinel: string;
  cwd?: string;
  deadlineMs?: number;
  killGraceMs?: number;
  inheritedEnv?: EnvironmentInput;
  env?: EnvironmentInput;
  failurePatterns?: readonly RegExp[];
}

export interface CheckedCommandResult {
  ok: boolean;
  exitCode: number;
  processExitCode: number | null;
  signal: NodeJS.Signals | null;
  reason: CheckedCommandReason;
  stdout: string;
  stderr: string;
  durationMs: number;
}

const DEFAULT_DEADLINE_MS = 120_000;
const DEFAULT_KILL_GRACE_MS = 250;
const HARD_CLOSE_GRACE_MS = 250;

const DEFAULT_FAILURE_PATTERNS = [
  /^\s*\(fail\)(?:\s|$)/im,
  /\b(?:test\s+)?timed out after\b/i,
  /# unhandled error between tests/i,
] as const;

interface ChildOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnError: boolean;
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function nonzeroExitCode(code: number | null): number {
  return code !== null && code > 0 && code <= 255 ? code : 1;
}

function matchesFailureOutput(output: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(output);
  });
}

function consumeCsiSequence(input: string, start: number): number {
  let index = start;
  while (index < input.length) {
    const code = input.charCodeAt(index);
    index += 1;
    if (code >= 0x40 && code <= 0x7e) break;
  }
  return index;
}

function consumeControlString(
  input: string,
  start: number,
  allowBellTerminator: boolean,
): number {
  let index = start;
  while (index < input.length) {
    const code = input.charCodeAt(index);
    if (allowBellTerminator && code === 0x07) return index + 1;
    if (
      code === 0x1b &&
      index + 1 < input.length &&
      input.charCodeAt(index + 1) === 0x5c
    ) {
      return index + 2;
    }
    index += 1;
  }
  return index;
}

/** Remove terminal formatting/control bytes before interpreting child output. */
function stripTerminalControlSequences(input: string): string {
  const output: string[] = [];
  let index = 0;

  while (index < input.length) {
    const code = input.charCodeAt(index);

    if (code === 0x1b) {
      const next = input.charCodeAt(index + 1);
      if (next === 0x5b) {
        index = consumeCsiSequence(input, index + 2);
      } else if (next === 0x5d) {
        index = consumeControlString(input, index + 2, true);
      } else if ([0x50, 0x58, 0x5e, 0x5f].includes(next)) {
        index = consumeControlString(input, index + 2, false);
      } else {
        index = Math.min(index + 2, input.length);
      }
      continue;
    }

    if (code === 0x9b) {
      index = consumeCsiSequence(input, index + 1);
      continue;
    }
    if (code === 0x9d) {
      index = consumeControlString(input, index + 1, true);
      continue;
    }
    if ([0x90, 0x98, 0x9e, 0x9f].includes(code)) {
      index = consumeControlString(input, index + 1, false);
      continue;
    }

    if (
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      index += 1;
      continue;
    }

    output.push(input[index]);
    index += 1;
  }

  return output.join("");
}

function isNoSuchProcess(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ESRCH"
  );
}

function terminateChildTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
  isolatedProcessGroup: boolean,
): void {
  if (isolatedProcessGroup && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (isNoSuchProcess(error)) return;
      // Fall through to the direct-child fallback if the group signal is denied.
    }
  }

  try {
    child.kill(signal);
  } catch (error) {
    if (!isNoSuchProcess(error)) throw error;
  }
}

/**
 * Execute one argv-only child command and independently grade its completion.
 * Exit zero is necessary but not sufficient: output must be clean and the
 * caller-provided completion sentinel must be present.
 */
export async function runCheckedCommand(
  options: CheckedCommandOptions,
): Promise<CheckedCommandResult> {
  if (options.command.length === 0 || options.command[0].length === 0) {
    throw new TypeError("checked command requires an executable");
  }
  if (options.completionSentinel.length === 0) {
    throw new TypeError("checked command requires a completion sentinel");
  }

  const startedAt = performance.now();
  const deadlineMs = positiveDuration(options.deadlineMs, DEFAULT_DEADLINE_MS);
  const killGraceMs = positiveDuration(
    options.killGraceMs,
    DEFAULT_KILL_GRACE_MS,
  );
  const inheritedEnv = options.inheritedEnv ?? process.env;
  const childEnvironment = createHermeticEnvironment({
    inherited: inheritedEnv,
    overrides: options.env,
  });
  const redactionEnvironment = { ...inheritedEnv, ...options.env };

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const isolatedProcessGroup = process.platform !== "win32";
  let child: ChildProcessWithoutNullStreams;

  try {
    child = spawn(options.command[0], options.command.slice(1), {
      cwd: options.cwd,
      env: childEnvironment as NodeJS.ProcessEnv,
      detached: isolatedProcessGroup,
      shell: false,
      stdio: "pipe",
    });
    child.stdin.end();
  } catch {
    return {
      ok: false,
      exitCode: 1,
      processExitCode: null,
      signal: null,
      reason: "spawn-error",
      stdout: "",
      stderr: "",
      durationMs: performance.now() - startedAt,
    };
  }

  child.stdout.on("data", (chunk: Buffer | string) => {
    stdoutChunks.push(Buffer.from(chunk));
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderrChunks.push(Buffer.from(chunk));
  });

  let deadlineExceeded = false;
  let forceKillSent = false;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  let hardCloseTimer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await new Promise<ChildOutcome>((resolve) => {
    let settled = false;
    let pendingClose: ChildOutcome | undefined;

    const finish = (value: ChildOutcome): void => {
      if (settled) return;
      settled = true;
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      if (hardCloseTimer !== undefined) clearTimeout(hardCloseTimer);
      resolve(value);
    };

    const handleClose = (value: ChildOutcome): void => {
      if (!deadlineExceeded || forceKillSent) finish(value);
      else pendingClose = value;
    };

    child.once("error", () => {
      handleClose({ code: null, signal: null, spawnError: true });
    });
    child.once("close", (code, signal) => {
      handleClose({ code, signal, spawnError: false });
    });

    deadlineTimer = setTimeout(() => {
      deadlineExceeded = true;
      terminateChildTree(child, "SIGTERM", isolatedProcessGroup);

      forceKillTimer = setTimeout(() => {
        forceKillSent = true;
        terminateChildTree(child, "SIGKILL", isolatedProcessGroup);
        if (pendingClose !== undefined) {
          finish(pendingClose);
          return;
        }

        hardCloseTimer = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
          finish({ code: null, signal: "SIGKILL", spawnError: false });
        }, HARD_CLOSE_GRACE_MS);
      }, killGraceMs);
    }, deadlineMs);
  });

  const rawStdout = Buffer.concat(stdoutChunks).toString("utf8");
  const rawStderr = Buffer.concat(stderrChunks).toString("utf8");
  const normalizedStdout = stripTerminalControlSequences(rawStdout);
  const normalizedStderr = stripTerminalControlSequences(rawStderr);
  const normalizedOutput = `${normalizedStdout}\n${normalizedStderr}`;
  const stdout = redactSecretValues(normalizedStdout, redactionEnvironment);
  const stderr = redactSecretValues(normalizedStderr, redactionEnvironment);

  let reason: CheckedCommandReason;
  let exitCode: number;

  if (deadlineExceeded) {
    reason = "deadline-exceeded";
    exitCode = 124;
  } else if (outcome.spawnError) {
    reason = "spawn-error";
    exitCode = 1;
  } else if (outcome.code !== 0) {
    reason = "nonzero-exit";
    exitCode = nonzeroExitCode(outcome.code);
  } else if (
    matchesFailureOutput(normalizedOutput, [
      ...DEFAULT_FAILURE_PATTERNS,
      ...(options.failurePatterns ?? []),
    ])
  ) {
    reason = "failure-output";
    exitCode = 1;
  } else if (!normalizedOutput.includes(options.completionSentinel)) {
    reason = "missing-sentinel";
    exitCode = 1;
  } else {
    reason = "success";
    exitCode = 0;
  }

  return {
    ok: exitCode === 0,
    exitCode,
    processExitCode: outcome.code,
    signal: outcome.signal,
    reason,
    stdout,
    stderr,
    durationMs: performance.now() - startedAt,
  };
}

interface CliOptions {
  command: [string, ...string[]];
  completionSentinel: string;
  cwd?: string;
  deadlineMs?: number;
  killGraceMs?: number;
}

function parseCliArguments(argv: readonly string[]): CliOptions {
  let completionSentinel: string | undefined;
  let cwd: string | undefined;
  let deadlineMs: number | undefined;
  let killGraceMs: number | undefined;
  let index = 0;

  while (index < argv.length && argv[index] !== "--") {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new TypeError("missing checked-command value");

    if (flag === "--sentinel") completionSentinel = value;
    else if (flag === "--cwd") cwd = value;
    else if (flag === "--deadline-ms") deadlineMs = Number(value);
    else if (flag === "--kill-grace-ms") killGraceMs = Number(value);
    else throw new TypeError("unknown checked-command option");
    index += 2;
  }

  const command = argv.slice(index + 1);
  if (argv[index] !== "--" || command.length === 0 || !completionSentinel) {
    throw new TypeError("invalid checked-command arguments");
  }

  return {
    command: command as [string, ...string[]],
    completionSentinel,
    cwd,
    deadlineMs,
    killGraceMs,
  };
}

async function main(): Promise<void> {
  try {
    const result = await runCheckedCommand(parseCliArguments(Bun.argv.slice(2)));
    if (result.stdout.length > 0) process.stdout.write(result.stdout);
    if (result.stderr.length > 0) process.stderr.write(result.stderr);
    if (!result.ok) {
      process.stderr.write(`\n[checked-command] ${result.reason}\n`);
    }
    process.exitCode = result.exitCode;
  } catch (error) {
    const diagnostic =
      error instanceof EnvironmentPolicyError
        ? error.message
        : "invalid checked-command invocation";
    process.stderr.write(`[checked-command] ${diagnostic}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.main) await main();
