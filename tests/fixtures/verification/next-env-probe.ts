import { loadEnvConfig } from "@next/env";

const fixtureRoot = Bun.argv[2];
if (!fixtureRoot) throw new Error("next env probe requires a fixture root");

const result = loadEnvConfig(
  fixtureRoot,
  false,
  { error() {}, info() {} },
  true,
);

if (!result.loadedEnvFiles.some((file) => file.path === ".env.local")) {
  throw new Error("Next did not load the adversarial .env.local fixture");
}

const expected = JSON.parse(
  process.env.EXPECTED_CONTROLLED_ENV_JSON ?? "{}",
) as Record<string, string>;
if (Object.keys(expected).length === 0) {
  throw new Error("next env probe received no controlled environment contract");
}

for (const [key, value] of Object.entries(expected)) {
  if (process.env[key] !== value) {
    throw new Error(`Next replaced explicit environment key ${key}`);
  }
}

process.stdout.write("NEXT_ENV_POISON_PROBE_COMPLETE\n");
