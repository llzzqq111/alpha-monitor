import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  await run("node", ["scripts/update-telegram.mjs"]);
  await run("node", ["scripts/build-site.mjs"]);
  try {
    await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "deploy-public-silent.ps1"]);
  } catch (error) {
    console.error(`Publish skipped or failed: ${error.message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
