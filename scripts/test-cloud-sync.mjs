import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncFromCloud, blobSha, allowedPath } from "./sync-from-cloud.mjs";
import { cloudEnabled, requireLocalPublisher } from "./cloud-mode.mjs";

const now = new Date("2026-10-29T01:00:00Z");
const state = { channel: "dodtwitterbot", mode: "github-actions", lastMessageId: 123, lastCheckedAt: now.toISOString(), coverageComplete: true };
const data = { collection: state, projects: [{ account: "example" }] };
const files = new Map(Object.entries({
  "data.json": JSON.stringify(data), "site/data.json": JSON.stringify(data),
  "collection-state.json": JSON.stringify(state), "telegram_project_counts.csv": "project,total_mentions\nexample,2\n",
  "avatar_cache.csv": "account,avatar_url\n", "snapshots/telegram-cloud-baseline-2026-10-28.csv": "message_id\ndodtwitterbot/123\n",
  "reports/2026-10-29-0100-telegram.md": "# Verified report\n",
}).map(([name, value]) => [name, Buffer.from(value)]));
const commit = "a".repeat(40);
const tree = [...files].map(([name, bytes]) => ({ path: name, sha: blobSha(bytes), mode: "100644", type: "blob" }));
tree.push({ path: "github_token.txt", sha: "b".repeat(40), mode: "100644", type: "blob" });
function fixture({ corrupt = false, unpublished = false, incomplete = false } = {}) {
  return async (url) => {
    if (url.endsWith("/git/ref/heads/main")) return Buffer.from(JSON.stringify({ object: { sha: commit } }));
    if (url.includes("/git/commits/")) return Buffer.from(JSON.stringify({ tree: { sha: "b".repeat(40) } }));
    if (url.includes("/git/trees/")) return Buffer.from(JSON.stringify({ tree, truncated: incomplete }));
    if (url.startsWith("https://llzzqq111.github.io/")) return Buffer.from(JSON.stringify(unpublished ? { old: true } : data));
    const name = url.split(`/${commit}/`)[1];
    assert(files.has(name), `Unexpected download: ${url}`);
    return corrupt ? Buffer.from("bad checksum") : files.get(name);
  };
}

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "alpha-cloud-sync-test-"));
try {
  const directory = path.join(temporaryRoot, "workspace");
  await fs.mkdir(path.join(directory, "snapshots"), { recursive: true });
  await fs.writeFile(path.join(directory, "data.json"), "old local archive");
  await fs.writeFile(path.join(directory, "snapshots", "telegram-historical.csv"), "old private archive");
  assert.equal(cloudEnabled(directory), false);
  const result = await syncFromCloud({ directory, get: fixture(), now, activate: true });
  assert.equal(result.projects, 1);
  assert.equal(cloudEnabled(directory), true);
  assert.throws(() => requireLocalPublisher(directory), /Cloud monitoring is active/);
  assert.equal(await fs.readFile(path.join(directory, "snapshots", "telegram-historical.csv"), "utf8"), "old private archive");
  const backupDirectory = path.join(directory, "logs", "cloud-backups", now.toISOString().replace(/[:.]/g, "-"));
  assert.equal(await fs.readFile(path.join(backupDirectory, "data.json"), "utf8"), "old local archive");
  await assert.rejects(fs.access(path.join(directory, "github_token.txt")));
  assert.equal((await syncFromCloud({ directory, get: fixture(), now })).changed, 0);
  assert.equal(allowedPath("snapshots/../github_token.txt"), false);
  assert.equal(allowedPath("reports/session.json"), false);
  await assert.rejects(syncFromCloud({ directory, get: fixture({ unpublished: true }), now }), /not finished public deployment/);
  await assert.rejects(syncFromCloud({ directory, get: fixture({ incomplete: true }), now }), /Incomplete cloud tree/);

  const second = path.join(temporaryRoot, "unchanged");
  await fs.mkdir(second);
  await fs.writeFile(path.join(second, "data.json"), "keep me");
  await assert.rejects(syncFromCloud({ directory: second, get: fixture({ corrupt: true }), now }), /checksum/);
  await assert.rejects(syncFromCloud({ directory: second, get: fixture(), now: new Date(now.getTime() + 9 * 3600000), activate: true }), /stale/);
  assert.equal(await fs.readFile(path.join(second, "data.json"), "utf8"), "keep me");
  assert.equal(cloudEnabled(second), false);
  await fs.mkdir(path.join(second, "snapshots"));
  await fs.writeFile(path.join(second, "snapshots", "telegram-cloud-baseline-2026-10-28.csv"), "conflicting snapshot");
  await assert.rejects(syncFromCloud({ directory: second, get: fixture(), now }), /Conflicting local snapshot/);
  assert.equal(await fs.readFile(path.join(second, "data.json"), "utf8"), "keep me");
  console.log("Cloud sync passed: pinned commit, checksums, published data, idempotence, old archives, conflict protection, no secrets, stale checks, read-only mode.");
} finally {
  if (!path.resolve(temporaryRoot).startsWith(path.resolve(os.tmpdir()) + path.sep + "alpha-cloud-sync-test-")) throw new Error("Unexpected fixture cleanup path");
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
