export type EnvironmentInput = Readonly<
  Record<string, string | undefined>
>;

export interface HermeticEnvironmentOptions {
  /** Process state to retain after production-capable keys are removed. */
  inherited?: EnvironmentInput;
  /** Explicit, policy-checked values needed by a local test fixture. */
  overrides?: EnvironmentInput;
}

const CONTROLLED_PREFIXES = [
  "AWS_",
  "CF_",
  "CLOUDFLARE_",
  "R2_",
  "TURSO_",
] as const;

const CONTROLLED_EXACT_KEYS = new Set([
  "DATABASE_AUTH_TOKEN",
  "DATABASE_URL",
  "LIBSQL_AUTH_TOKEN",
  "LIBSQL_URL",
  "RUN_PRODUCTION_INTEGRATION",
]);

const LOCAL_DATABASE_KEYS = new Set([
  "DATABASE_URL",
  "LIBSQL_URL",
  "TURSO_DATABASE_URL",
]);

const FAKE_IDENTIFIER_KEYS = new Set([
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "R2_ACCESS_KEY_ID",
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_SECRET_ACCESS_KEY",
]);

const LOCAL_ENDPOINT_KEYS = new Set([
  "AWS_ENDPOINT_URL",
  "R2_ENDPOINT",
  "R2_PUBLIC_BASE_URL",
]);

const SAFE_REGION_KEYS = new Set(["AWS_DEFAULT_REGION", "AWS_REGION"]);

const SECRET_KEY_PATTERN =
  /(?:ACCESS_KEY|API_KEY|AUTH|CREDENTIAL|DATABASE_URL|LIBSQL_URL|PASSWORD|PRIVATE_KEY|SECRET|TOKEN)/i;

export class EnvironmentPolicyError extends Error {
  readonly unsafeKeys: readonly string[];

  constructor(unsafeKeys: readonly string[]) {
    const keys = [...new Set(unsafeKeys)].sort();
    super(
      `Unsafe hermetic environment override${keys.length === 1 ? "" : "s"}: ${keys.join(
        ", ",
      )}. Values are redacted.`,
    );
    this.name = "EnvironmentPolicyError";
    this.unsafeKeys = keys;
  }
}

export function isPolicyControlledEnvironmentKey(key: string): boolean {
  return (
    CONTROLLED_EXACT_KEYS.has(key) ||
    CONTROLLED_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

function isLocalDatabaseUrl(value: string): boolean {
  if (!value.startsWith("file:") || /[\r\n]/.test(value)) return false;

  try {
    const url = new URL(value);
    return (
      url.protocol === "file:" &&
      (url.hostname === "" || url.hostname.toLowerCase() === "localhost")
    );
  } catch {
    return false;
  }
}

function isFakeIdentifier(value: string): boolean {
  return /^(?:fake|local|test)(?:[-_].+)?$/i.test(value);
}

function isLocalOrNonRoutingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;

    const hostname = url.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".invalid")
    );
  } catch {
    return false;
  }
}

function isSafeExplicitValue(key: string, value: string): boolean {
  if (LOCAL_DATABASE_KEYS.has(key)) return isLocalDatabaseUrl(value);
  if (FAKE_IDENTIFIER_KEYS.has(key)) return isFakeIdentifier(value);
  if (LOCAL_ENDPOINT_KEYS.has(key)) return isLocalOrNonRoutingUrl(value);
  if (SAFE_REGION_KEYS.has(key)) {
    return /^(?:auto|local|test|us-east-1)$/i.test(value);
  }

  // Cloudflare control-plane credentials, DB auth tokens, production-integration
  // switches, and unknown production-capable keys have no hermetic use.
  return false;
}

/**
 * Build a child environment without inheriting production-capable credentials.
 * Controlled values can only re-enter through explicit, locally safe overrides.
 */
export function createHermeticEnvironment(
  options: HermeticEnvironmentOptions = {},
): Record<string, string> {
  const inherited = options.inherited ?? process.env;
  const environment: Record<string, string> = {};

  for (const [key, value] of Object.entries(inherited)) {
    if (value === undefined || isPolicyControlledEnvironmentKey(key)) continue;
    environment[key] = value;
  }

  const unsafeKeys: string[] = [];
  for (const [key, value] of Object.entries(options.overrides ?? {})) {
    if (value === undefined || value === "") {
      delete environment[key];
      continue;
    }

    if (
      isPolicyControlledEnvironmentKey(key) &&
      !isSafeExplicitValue(key, value)
    ) {
      unsafeKeys.push(key);
      continue;
    }

    environment[key] = value;
  }

  if (unsafeKeys.length > 0) throw new EnvironmentPolicyError(unsafeKeys);
  return environment;
}

function isSecretEnvironmentKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/** Replace exact credential values before captured child output is returned. */
export function redactSecretValues(
  diagnostic: string,
  environment: EnvironmentInput,
): string {
  const secrets = Object.entries(environment)
    .filter(
      ([key, value]) =>
        isSecretEnvironmentKey(key) && value !== undefined && value.length > 0,
    )
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);

  let redacted = diagnostic;
  for (const secret of new Set(secrets)) {
    redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted;
}
