import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cloudEnabled } from "./cloud-mode.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  if (cloudEnabled(root)) {
    await run(process.execPath, ["scripts/sync-from-cloud.mjs"]);
    return;
  }
  let sourceError;
  try {
    await run(process.execPath, ["scripts/update-telegram.mjs"]);
  } catch (error) {
    sourceError = error;
    console.error(`Telegram collection failed; syncing preserved local data: ${error.message}`);
  }
  await run(process.execPath, ["scripts/build-site.mjs"]);
  await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "deploy-public-silent.ps1"]);
  if (sourceError) throw new Error("Existing data published, but Telegram collection failed; no fresh collection confirmed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
