import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const repository = "https://api.github.com/repos/llzzqq111/alpha-monitor";
const required = ["data.json", "site/data.json", "collection-state.json", "telegram_project_counts.csv", "avatar_cache.csv"];
export const blobSha = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
export const allowedPath = (name) => required.includes(name) || /^snapshots\/telegram-[A-Za-z0-9_-]+\.csv$/.test(name) || /^reports\/\d{4}-\d{2}-\d{2}[A-Za-z0-9_-]*\.md$/.test(name);

async function safeTarget(base, name) {
  const target = path.resolve(base, name);
  if (!target.startsWith(path.resolve(base) + path.sep)) throw new Error("Backup target escaped workspace");
  for (let parent = target; parent !== path.dirname(base); parent = path.dirname(parent)) {
    try { if ((await fs.lstat(parent)).isSymbolicLink()) throw new Error(`Refusing symlink: ${parent}`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (parent === path.resolve(base)) break;
  }
  return target;
}

async function request(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": "AlphaMonitor-cloud-backup", accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw Object.assign(new Error(`Cloud backup HTTP ${response.status}`), { status: response.status });
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 3 || (error.status && error.status < 500 && error.status !== 429)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

export async function syncFromCloud({ directory = root, get = request, now = new Date(), activate = false } = {}) {
  directory = path.resolve(directory);
  const json = async (url) => JSON.parse((await get(url)).toString("utf8"));
  const ref = await json(`${repository}/git/ref/heads/main`);
  const commit = ref.object?.sha;
  if (!/^[a-f0-9]{40}$/.test(commit || "")) throw new Error("Invalid remote commit");
  const parent = await json(`${repository}/git/commits/${commit}`);
  const tree = await json(`${repository}/git/trees/${parent.tree.sha}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error("Incomplete cloud tree; local backup unchanged");
  const entries = tree.tree.filter((entry) => entry.type === "blob" && entry.mode === "100644" && allowedPath(entry.path));
  if (!required.every((name) => entries.some((entry) => entry.path === name))) throw new Error("Cloud data files missing");
  const contents = new Map();
  const changes = [];
  for (const entry of entries) {
    const target = await safeTarget(directory, entry.path);
    let previous;
    try { previous = await fs.readFile(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (previous && blobSha(previous) === entry.sha) {
      contents.set(entry.path, previous);
      continue;
    }
    if (previous && entry.path.startsWith("snapshots/")) throw new Error(`Conflicting local snapshot preserved: ${entry.path}`);
    const bytes = await get(`https://raw.githubusercontent.com/llzzqq111/alpha-monitor/${commit}/${entry.path}`);
    if (blobSha(bytes) !== entry.sha) throw new Error(`Cloud blob checksum failed: ${entry.path}`);
    contents.set(entry.path, bytes);
    changes.push({ name: entry.path, target, bytes, previous });
  }
  const state = JSON.parse(contents.get("collection-state.json"));
  const data = JSON.parse(contents.get("data.json"));
  const checked = Date.parse(state.lastCheckedAt);
  if (state.channel !== "dodtwitterbot" || state.mode !== "github-actions" || state.coverageComplete !== true || !Number.isSafeInteger(state.lastMessageId) || !Number.isFinite(checked)) throw new Error("No verified cloud collection; local data unchanged");
  if (JSON.stringify(data.collection) !== JSON.stringify(state) || !contents.get("site/data.json").equals(contents.get("data.json"))) throw new Error("Inconsistent cloud checkpoint and website data");
  const live = await json(`https://llzzqq111.github.io/alpha-monitor/data.json?backup=${now.getTime()}`);
  if (JSON.stringify(live) !== JSON.stringify(data)) throw new Error("Cloud data has not finished public deployment; retry backup later");
  const stale = now.getTime() - checked > 8 * 60 * 60 * 1000;
  if (activate && stale) throw new Error("Cloud collection is stale; refusing switch-over");
  const backup = `logs/cloud-backups/${now.toISOString().replace(/[:.]/g, "-")}`;
  for (const item of changes) {
    if (item.previous) {
      const archive = await safeTarget(directory, `${backup}/${item.name}`);
      await fs.mkdir(path.dirname(archive), { recursive: true });
      await fs.writeFile(archive, item.previous, { flag: "wx" });
    }
  }
  for (const item of changes) {
    await fs.mkdir(path.dirname(item.target), { recursive: true });
    const temporary = `${item.target}.cloud-${process.pid}.tmp`;
    await fs.writeFile(temporary, item.bytes, { flag: "wx" });
    await fs.rename(temporary, item.target);
  }
  const marker = await safeTarget(directory, "cloud-monitor.json");
  let config;
  try { config = JSON.parse(await fs.readFile(marker, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (activate || config?.enabled) {
    await fs.writeFile(marker, JSON.stringify({ ...config, enabled: true, repository: "llzzqq111/alpha-monitor", source: "public-telegram", lastSyncedCommit: commit, lastSyncedAt: now.toISOString(), lastCloudCheckAt: state.lastCheckedAt, lastMessageId: state.lastMessageId }, null, 2) + "\n");
  }
  console.log(`Cloud backup synced ${changes.length} files, ${data.projects.length} projects; TG checked ${state.lastCheckedAt}. No local publishing.`);
  if (stale) throw new Error("Latest published data saved locally, but cloud has not checked TG for more than eight hours");
  return { commit, projects: data.projects.length, changed: changes.length, state };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  syncFromCloud({ activate: process.argv.includes("--activate") }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
