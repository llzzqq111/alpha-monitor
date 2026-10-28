import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { requireLocalPublisher } from "./cloud-mode.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const apiRoot = "https://api.github.com/repos/llzzqq111/alpha-monitor";
const blobSha = (content) => createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");

async function publicFiles() {
  const startDate = (await fs.readFile(path.join(root, "public-data-start.txt"), "utf8")).trim();
  const files = ["index.html", "app.js", "styles.css", "data.json", "README.md"];
  for (const file of await fs.readdir(path.join(root, "reports"))) {
    const date = file.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (file.endsWith(".md") && date && date >= startDate) files.push(`reports/${file}`);
  }
  const entries = [];
  for (const file of files) {
    const content = await fs.readFile(path.join(root, file), "utf8");
    entries.push({ path: file, mode: "100644", type: "blob", content });
  }
  return { entries, startDate };
}

async function main() {
  requireLocalPublisher(root);
  const { entries, startDate } = await publicFiles();
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ files: entries.map((entry) => entry.path), startDate }, null, 2));
    return;
  }
  const tokenText = process.env.ALPHA_MONITOR_GITHUB_TOKEN || await fs.readFile(path.join(root, "github_token.txt"), "utf8");
  const token = tokenText.trim().match(/(?:github_pat_|ghp_)[A-Za-z0-9_]+/)?.[0];
  if (!token) throw new Error("Missing valid GitHub publishing token");
  async function request(endpoint, method = "GET", body) {
    const response = await fetch(`${apiRoot}${endpoint}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(45000),
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "AlphaMonitor-publisher",
        "x-github-api-version": "2026-03-10",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${endpoint}: HTTP ${response.status}`);
    return response.json();
  }
  const ref = await request("/git/ref/heads/main");
  const parent = await request(`/git/commits/${ref.object.sha}`);
  const current = await request(`/git/trees/${parent.tree.sha}?recursive=1`);
  if (current.truncated) throw new Error("Public repository tree is incomplete; refusing to publish");
  const existing = new Map(current.tree.map((entry) => [entry.path, entry]));
  const changes = entries.filter((entry) => existing.get(entry.path)?.sha !== blobSha(entry.content));
  for (const entry of current.tree) {
    const date = entry.path.match(/^reports\/(\d{4}-\d{2}-\d{2})/)?.[1];
    if (entry.type === "blob" && date && date < startDate) changes.push({ path: entry.path, mode: entry.mode, type: "blob", sha: null });
  }
  if (!changes.length) {
    console.log("No dashboard changes.");
    return;
  }
  const tree = await request("/git/trees", "POST", { base_tree: parent.tree.sha, tree: changes });
  const commit = await request("/git/commits", "POST", { message: "Update Telegram dashboard data", tree: tree.sha, parents: [ref.object.sha] });
  await request("/git/refs/heads/main", "PATCH", { sha: commit.sha, force: false });
  console.log(`Published dashboard via GitHub API: ${commit.sha}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
