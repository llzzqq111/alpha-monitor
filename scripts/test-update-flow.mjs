import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import vm from "node:vm";

const source = (await readFile(new URL("./update-all.mjs", import.meta.url), "utf8")).replace(/^import[^\n]+\r?\n/gm, "").replace('const root = fileURLToPath(new URL("../", import.meta.url));', 'const root = "fixture";');
async function simulate(exits, cloud = false) {
  const calls = [];
  const errors = [];
  let exitCode = 0;
  vm.runInNewContext(source, {
    cloudEnabled() { return cloud; },
    spawn(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("exit", exits[calls.length - 1]));
      return child;
    },
    process: { execPath: "node-fixture", exit(code) { exitCode = code; } },
    console: { error(message) { errors.push(String(message)); } },
  });
  await new Promise(setImmediate);
  return { calls, errors, exitCode };
}

const success = await simulate([0, 0, 0]);
assert.equal(success.exitCode, 0);
assert.deepEqual(success.calls.map((call) => call.args[0]), ["scripts/update-telegram.mjs", "scripts/build-site.mjs", "-NoProfile"]);
assert(success.calls.every((call) => call.options.windowsHide === true));
const publishFailed = await simulate([0, 0, 1]);
assert.equal(publishFailed.exitCode, 1);
const sourceFailed = await simulate([2, 0, 0]);
assert.equal(sourceFailed.calls.length, 3);
assert.equal(sourceFailed.exitCode, 1);
assert(sourceFailed.errors.some((message) => message.includes("no fresh collection confirmed")));
const buildFailed = await simulate([0, 1]);
assert.equal(buildFailed.calls.length, 2);
assert.equal(buildFailed.exitCode, 1);
const cloudSuccess = await simulate([0], true);
assert.equal(cloudSuccess.exitCode, 0);
assert.deepEqual(cloudSuccess.calls.map((call) => call.args[0]), ["scripts/sync-from-cloud.mjs"]);
const cloudFailed = await simulate([1], true);
assert.equal(cloudFailed.exitCode, 1);
assert.equal(cloudFailed.calls.length, 1);
console.log("Update flow passed: local build followed by publishing, hidden subprocesses, source/publish errors remain failures.");
