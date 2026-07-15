const mode = Bun.argv[2];

switch (mode) {
  case "success":
    console.log("fixture completed");
    console.log("__CHECKED_COMMAND_COMPLETE__");
    break;
  case "fail-output":
    console.error("(fail) deliberate exit-zero failure fixture");
    break;
  case "timeout-output":
    console.error("error: Test timed out after 50ms");
    break;
  case "ansi-fail-output":
    console.error("\u001b[31m(fail)\u001b[0m colored failure fixture");
    break;
  case "ansi-timeout-output":
    console.error("error: Test \u001b[31mtimed out after\u001b[0m 50ms");
    break;
  case "missing-sentinel":
    console.log("fixture exited cleanly without its completion marker");
    break;
  case "nonzero":
    console.error("deliberate nonzero fixture");
    process.exitCode = 7;
    break;
  case "echo-r2-secret":
    console.log(`secret=${process.env.R2_SECRET_ACCESS_KEY ?? "missing"}`);
    console.log("__CHECKED_COMMAND_COMPLETE__");
    break;
  default:
    console.error("unknown fixture mode");
    process.exitCode = 2;
}
