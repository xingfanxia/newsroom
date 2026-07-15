import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const mode = Bun.argv[2] ?? "direct";

if (mode === "descendant") {
  process.on("SIGTERM", () => {
    // Prove that the controller's SIGKILL reaches the whole process group.
  });
} else if (mode === "spawn-descendant") {
  const descendant = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "descendant"],
    { stdio: "ignore" },
  );
  if (descendant.pid === undefined) throw new Error("descendant has no pid");
  console.log(`descendant-pid=${descendant.pid}`);
} else {
  console.log("hang fixture started");
}

setInterval(() => {
  // Keep the event loop alive until the checked-command controller terminates us.
}, 1_000);
