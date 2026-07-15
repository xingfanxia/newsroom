interface CheckedStageArguments {
  sentinel: string;
  command: [string, ...string[]];
}

function parseArguments(argv: readonly string[]): CheckedStageArguments {
  if (argv[0] !== "--sentinel" || !argv[1]) {
    throw new TypeError("checked stage requires --sentinel <value>");
  }
  if (argv[2] !== "--" || !argv[3]) {
    throw new TypeError("checked stage requires -- <command> [args]");
  }

  return {
    sentinel: argv[1],
    command: argv.slice(3) as [string, ...string[]],
  };
}

async function main(): Promise<void> {
  try {
    const { sentinel, command } = parseArguments(Bun.argv.slice(2));
    const child = Bun.spawn(command, {
      cwd: process.cwd(),
      env: process.env,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await child.exited;
    if (exitCode === 0) process.stdout.write(`${sentinel}\n`);
    process.exitCode = exitCode;
  } catch {
    process.stderr.write("[checked-stage] invalid invocation\n");
    process.exitCode = 2;
  }
}

if (import.meta.main) await main();
