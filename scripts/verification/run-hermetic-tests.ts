import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
  redactSecretValues,
  type EnvironmentInput,
} from "./environment-policy";
import { runCheckedCommand } from "./run-checked-command";

export const PRODUCTION_INTEGRATION_INPUTS = [
  "tests/integration/production/api/collections.integration.ts",
  "tests/integration/production/api/policy-commit.integration.ts",
  "tests/integration/production/api/public-feed.integration.ts",
  "tests/integration/production/api/public-search.integration.ts",
  "tests/integration/production/api/saved-routes.integration.ts",
  "tests/integration/production/api/tweak-routes.integration.ts",
  "tests/integration/production/api/v1.integration.ts",
  "tests/integration/production/auth/feedback-schema.integration.ts",
  "tests/integration/production/feedback/metrics.integration.ts",
  "tests/integration/production/feedback/toggle.integration.ts",
  "tests/integration/production/items/collections.integration.ts",
] as const;

export const LIVE_PRODUCTION_INTEGRATION_INPUTS = [
  "tests/integration/production/api/v1-semantic.live.ts",
] as const;

const DEFAULT_TEST_ROOTS = ["tests", "workers"] as const;
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const PRODUCTION_INPUT_SET = new Set<string>([
  ...PRODUCTION_INTEGRATION_INPUTS,
  ...LIVE_PRODUCTION_INTEGRATION_INPUTS,
]);
const PRODUCTION_INTEGRATION_ROOT = "tests/integration/production";
const FAILURE_OUTPUT_PATTERNS = [
  /^\s*\(fail\)(?:\s|$)/im,
  /\b(?:test\s+)?timed out after\b/i,
  /# unhandled error between tests/i,
] as const;

export interface ProductionIntegrationEnvironment {
  readonly RUN_PRODUCTION_INTEGRATION?: string;
  readonly TURSO_DATABASE_URL?: string;
  readonly [key: string]: string | undefined;
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function repoRelativeInput(root: string, input: string): string {
  const absolute = isAbsolute(input) ? resolve(input) : resolve(root, input);
  const relativePath = relative(root, absolute);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Test input is outside the repository: ${input}`);
  }
  return toPosixPath(relativePath);
}

function walkFiles(directory: string): string[] {
  if (!statSync(directory, { throwIfNoEntry: false })) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export function discoverDefaultTestInputs(root: string): string[] {
  return DEFAULT_TEST_ROOTS.flatMap((directory) =>
    walkFiles(resolve(root, directory)),
  )
    .filter((file) => TEST_FILE_PATTERN.test(file))
    .map((file) => repoRelativeInput(root, file))
    .filter((file) => !PRODUCTION_INPUT_SET.has(file))
    .sort();
}

export function discoverTursoGatedTestInputs(root: string): string[] {
  return discoverDefaultTestInputs(root).filter((file) =>
    readFileSync(resolve(root, file), "utf8").includes(
      "process.env.TURSO_DATABASE_URL",
    ),
  );
}

export function selectHermeticTestInputs(
  root: string,
  requestedInputs: readonly string[] = [],
): string[] {
  const inputs =
    requestedInputs.length === 0
      ? discoverDefaultTestInputs(root)
      : requestedInputs.map((input) => repoRelativeInput(root, input));

  const productionInputs = inputs.filter(
    (input) =>
      input === PRODUCTION_INTEGRATION_ROOT ||
      input.startsWith(`${PRODUCTION_INTEGRATION_ROOT}/`) ||
      PRODUCTION_INPUT_SET.has(input) ||
      input.endsWith(".integration.ts") ||
      input.endsWith(".live.ts"),
  );
  if (productionInputs.length > 0) {
    throw new Error(
      `Production integration input is forbidden in the default test gate: ${productionInputs.join(
        ", ",
      )}`,
    );
  }

  if (inputs.length === 0) throw new Error("No hermetic test inputs discovered");

  if (requestedInputs.length > 0) {
    const defaultInputSet = new Set(discoverDefaultTestInputs(root));
    const invalidInputs = inputs.filter((input) => {
      const stats = statSync(resolve(root, input), { throwIfNoEntry: false });
      return !stats?.isFile() || !defaultInputSet.has(input);
    });
    if (invalidInputs.length > 0) {
      throw new Error(
        `Requested input is not a default discovered test file: ${invalidInputs.join(
          ", ",
        )}`,
      );
    }
  }

  return [...new Set(inputs)].sort();
}

export function assertProductionIntegrationOptIn(
  environment: ProductionIntegrationEnvironment = process.env,
): void {
  if (environment.RUN_PRODUCTION_INTEGRATION !== "1") {
    throw new Error(
      "Production integration is disabled. Set RUN_PRODUCTION_INTEGRATION=1 explicitly.",
    );
  }
  if (!environment.TURSO_DATABASE_URL) {
    throw new Error(
      "Production integration requires an explicit TURSO_DATABASE_URL.",
    );
  }
}

export function createHermeticRuntimeOverrides(
  fixtureRoot: string,
): Record<string, string> {
  const databasePath = resolve(fixtureRoot, "newsroom-hermetic.sqlite");
  const databaseUrl = pathToFileURL(databasePath).href;
  return {
    NODE_ENV: "test",
    NEXT_TELEMETRY_DISABLED: "1",
    RUN_LIVE_SEMANTIC_TEST: "0",
    TURSO_DATABASE_URL: databaseUrl,
    TURSO_AUTH_TOKEN: "fake-newsroom-turso-auth-token",
    TURSO_API_TOKEN: "fake-newsroom-turso-api-token",
    TURSO_ORG: "fake-newsroom-turso-org",
    DATABASE_URL: databaseUrl,
    DATABASE_AUTH_TOKEN: "fake-newsroom-database-auth-token",
    LIBSQL_URL: databaseUrl,
    LIBSQL_AUTH_TOKEN: "fake-newsroom-libsql-auth-token",
    AWS_ACCESS_KEY_ID: "fake-newsroom-access-key",
    AWS_SECRET_ACCESS_KEY: "fake-newsroom-secret-key",
    AWS_SESSION_TOKEN: "fake-newsroom-session-token",
    AWS_ENDPOINT_URL: "https://r2.invalid",
    AWS_DEFAULT_REGION: "auto",
    AWS_REGION: "auto",
    R2_ACCESS_KEY_ID: "fake-newsroom-access-key",
    R2_ACCOUNT_ID: "fake-newsroom-account",
    R2_BUCKET: "fake-newsroom-bucket",
    R2_SECRET_ACCESS_KEY: "fake-newsroom-secret-key",
    R2_ENDPOINT: "https://r2.invalid",
    R2_PUBLIC_BASE_URL: "https://content.invalid",
    RESEND_API_KEY: "fake-newsroom-resend-api-key",
    CF_ACCOUNT_ID: "fake-newsroom-cf-account",
    CF_API_KEY: "fake-newsroom-cf-api-key",
    CF_API_TOKEN: "fake-newsroom-cf-api-token",
    CF_ZONE_ID: "fake-newsroom-cf-zone",
    CLOUDFLARE_ACCOUNT_ID: "fake-newsroom-cloudflare-account",
    CLOUDFLARE_API_KEY: "fake-newsroom-cloudflare-api-key",
    CLOUDFLARE_API_TOKEN: "fake-newsroom-cloudflare-api-token",
    CLOUDFLARE_ZONE_ID: "fake-newsroom-cloudflare-zone",
  };
}

function stageCommand(
  root: string,
  sentinel: string,
  command: readonly [string, ...string[]],
): [string, ...string[]] {
  return [
    process.execPath,
    "--no-env-file",
    resolve(root, "scripts/verification/checked-stage.ts"),
    "--sentinel",
    sentinel,
    "--",
    ...command,
  ];
}

export interface HermeticTestRunOptions {
  root?: string;
  requestedInputs?: readonly string[];
  inheritedEnv?: EnvironmentInput;
  deadlineMs?: number;
}

export async function runHermeticTests(
  options: HermeticTestRunOptions = {},
): Promise<number> {
  const root = resolve(options.root ?? join(import.meta.dir, "../.."));
  const inputs = selectHermeticTestInputs(root, options.requestedInputs);
  const fixtureRoot = mkdtempSync(join(tmpdir(), "newsroom-hermetic-tests-"));
  const sentinel = `HERMETIC_TESTS_COMPLETE_${randomUUID()}`;

  try {
    const result = await runCheckedCommand({
      command: stageCommand(root, sentinel, [
        process.execPath,
        "--no-env-file",
        "test",
        ...inputs,
      ]),
      cwd: root,
      completionSentinel: sentinel,
      deadlineMs: options.deadlineMs ?? 300_000,
      inheritedEnv: options.inheritedEnv,
      env: createHermeticRuntimeOverrides(fixtureRoot),
    });

    if (result.stdout.length > 0) process.stdout.write(result.stdout);
    if (result.stderr.length > 0) process.stderr.write(result.stderr);
    if (!result.ok) {
      process.stderr.write(`[hermetic-tests] ${result.reason}\n`);
    }
    return result.exitCode;
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function stripTerminalControls(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
}

async function runProductionIntegration(
  root: string,
  inputs: readonly string[],
): Promise<number> {
  assertProductionIntegrationOptIn();
  const sentinel = `PRODUCTION_INTEGRATION_COMPLETE_${randomUUID()}`;
  const child = Bun.spawn(
    stageCommand(root, sentinel, [
      process.execPath,
      "--no-env-file",
      "test",
      ...inputs,
    ]),
    {
      cwd: root,
      env: process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, rawStdout, rawStderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const output = stripTerminalControls(`${rawStdout}\n${rawStderr}`);
  const failureOutput = FAILURE_OUTPUT_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(output);
  });
  const hasSentinel = output.includes(sentinel);
  const redactionEnvironment = process.env as EnvironmentInput;
  process.stdout.write(redactSecretValues(rawStdout, redactionEnvironment));
  process.stderr.write(redactSecretValues(rawStderr, redactionEnvironment));

  if (exitCode !== 0 || failureOutput || !hasSentinel) {
    process.stderr.write(
      `[production-integration] rejected: ${
        exitCode !== 0
          ? `exit-${exitCode}`
          : failureOutput
            ? "failure-output"
            : "missing-sentinel"
      }\n`,
    );
    return exitCode === 0 ? 1 : exitCode;
  }
  return 0;
}

async function main(): Promise<void> {
  const root = resolve(join(import.meta.dir, "../.."));
  const argv = Bun.argv.slice(2);
  try {
    if (argv[0] === "--production") {
      if (argv.length !== 1) throw new Error("Unknown production test arguments");
      process.exitCode = await runProductionIntegration(
        root,
        PRODUCTION_INTEGRATION_INPUTS,
      );
      return;
    }
    if (argv[0] === "--production-semantic") {
      if (argv.length !== 1) throw new Error("Unknown semantic test arguments");
      if (process.env.RUN_LIVE_SEMANTIC_TEST !== "1") {
        throw new Error(
          "Live semantic integration requires RUN_LIVE_SEMANTIC_TEST=1",
        );
      }
      process.exitCode = await runProductionIntegration(
        root,
        LIVE_PRODUCTION_INTEGRATION_INPUTS,
      );
      return;
    }

    const requestedInputs = argv[0] === "--" ? argv.slice(1) : argv;
    process.exitCode = await runHermeticTests({ root, requestedInputs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Test gate failed";
    process.stderr.write(`[hermetic-tests] ${message}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.main) await main();
