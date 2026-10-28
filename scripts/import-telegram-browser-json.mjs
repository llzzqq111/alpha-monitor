import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./csv.mjs";
import { parseFollow as parseTelegramFollow } from "./update-telegram.mjs";

const root = process.cwd();
const snapshotsDir = path.join(root, "snapshots");
const reportsDir = path.join(root, "reports");
const inputFile = path.resolve(root, process.argv.slice(2).find((arg) => !arg.startsWith("--")) || "browser-telegram-current.json");

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, headers) {
  return [headers.join(","), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))].join("\n") + "\n";
}

async function readCsv(file) {
  try {
    return parseCsv(await fs.readFile(file, "utf8"));
  } catch {
    return [];
  }
}

async function listFiles(dir) {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

function parseFollow(message) {
  const rawId = String(message.id || "");
  const id = /^\d+$/.test(rawId) ? `dodtwitterbot/${rawId}` : normalizeId(rawId);
  if (!/^dodtwitterbot\/\d+$/.test(id)) return null;
  return parseTelegramFollow({ ...message, id, datetime: message.time || message.datetime || "", text: String(message.text || ""), links: message.links || [] });
}

function normalizeId(value) {
  const id = String(value || "").match(/(?:dodtwitterbot\/)?(\d+)$/)?.[1];
  return id ? `dodtwitterbot/${id}` : String(value || "");
}

async function existingTelegramIds() {
  const ids = new Set();
  for (const file of await listFiles(snapshotsDir)) {
    if (!file.startsWith("telegram-") || !file.endsWith(".csv")) continue;
    for (const row of await readCsv(path.join(snapshotsDir, file))) {
      if (row.message_id) ids.add(normalizeId(row.message_id));
    }
  }
  return ids;
}

async function allTelegramRows() {
  const rows = new Map();
  for (const file of await listFiles(snapshotsDir)) {
    if (!file.startsWith("telegram-") || !file.endsWith(".csv")) continue;
    for (const row of await readCsv(path.join(snapshotsDir, file))) {
      const key = row.message_id ? normalizeId(row.message_id) : JSON.stringify(row);
      if (!rows.has(key)) rows.set(key, row);
    }
  }
  return [...rows.values()];
}

function statusFor(total, uniqueAlphas) {
  if (total >= 3 || uniqueAlphas >= 3) return "priority";
  if (total >= 1) return "watch";
  return "insufficient";
}

async function writeCounts(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = String(row.x_account || row.project || "").toLowerCase();
    if (!key) continue;
    if (!grouped.has(key)) {
      grouped.set(key, {
        project: row.project,
        x_account: row.x_account,
        total_mentions: 0,
        alphas: new Set(),
        first_seen_utc: row.datetime_utc,
        last_seen_utc: row.datetime_utc,
        description: row.description || "",
      });
    }
    const item = grouped.get(key);
    item.total_mentions += 1;
    if ((row.description || "").length > item.description.length) item.description = row.description;
    if (row.alpha) item.alphas.add(row.alpha);
    if (row.datetime_utc && (!item.first_seen_utc || row.datetime_utc < item.first_seen_utc)) item.first_seen_utc = row.datetime_utc;
    if (row.datetime_utc && (!item.last_seen_utc || row.datetime_utc > item.last_seen_utc)) item.last_seen_utc = row.datetime_utc;
  }
  const countRows = [...grouped.values()].map((item) => ({
    project: item.project,
    x_account: item.x_account,
    total_mentions: item.total_mentions,
    unique_alphas: item.alphas.size,
    alpha_names: [...item.alphas].sort().join("; "),
    description: item.description,
    first_seen_utc: item.first_seen_utc,
    last_seen_utc: item.last_seen_utc,
    status: statusFor(item.total_mentions, item.alphas.size),
  })).sort((a, b) => b.total_mentions - a.total_mentions || String(a.project).localeCompare(String(b.project)));
  await fs.writeFile(path.join(root, "telegram_project_counts.csv"), toCsv(countRows, ["project", "x_account", "total_mentions", "unique_alphas", "first_seen_utc", "last_seen_utc", "status", "alpha_names", "description"]), "utf8");
}

async function updateAvatarCache(rows) {
  const file = path.join(root, "avatar_cache.csv");
  const current = await readCsv(file);
  const known = new Map(current.filter((row) => row.account).map((row) => [row.account.toLowerCase(), row]));
  const now = new Date().toISOString();
  for (const row of rows) {
    const account = String(row.x_account || "").replace(/^@/, "").trim();
    if (!account || known.has(account.toLowerCase()) || !/^https:\/\//.test(row.avatar_url || "")) continue;
    known.set(account.toLowerCase(), {
      account,
      avatar_url: row.avatar_url,
      updated_at: now,
      source: "browser-tg",
    });
  }
  if (known.size !== current.length) await fs.writeFile(file, toCsv([...known.values()].sort((a, b) => a.account.localeCompare(b.account)), ["account", "avatar_url", "updated_at", "source"]), "utf8");
}

async function writeReport(newRows, payload) {
  if (!newRows.length) return;
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const lines = [
    `# Browser Telegram 更新 - ${now.toLocaleString("zh-CN", { hour12: false })}`,
    "",
    `新增 TG 关注记录：${newRows.length} 条。`,
    `读取来源：Telegram 频道公开关注通知；仅统计带 [Alpha] 标签的消息。`,
    `原始消息数：${payload.messages?.length || 0}；读取日期：${payload.date || "见各条消息"}（${payload.timezone || "原始时区"}）。`,
    `读取范围：${payload.messages?.[0]?.time || ""} 至 ${payload.messages?.at(-1)?.time || ""}。时间精度：${payload.timePrecision || "原始消息时间"}。`,
    `次数是已保存且去重的频道消息数，不是简介里的共同关注人数；简介为频道抓取的项目自述，未经独立核实。`,
    "",
    "| 项目 | X 账号 | Alpha | 时间 |",
    "|---|---|---|---|",
    ...newRows.map((row) => `| ${row.project} | @${row.x_account} | ${row.alpha} | ${row.datetime_utc} |`),
    "",
  ];
  await fs.writeFile(path.join(reportsDir, `${stamp}-telegram-browser.md`), lines.join("\n"), "utf8");
}

async function main() {
  const { requireLocalPublisher } = await import("./cloud-mode.mjs");
  requireLocalPublisher(root);
  await fs.mkdir(snapshotsDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });
  const payload = JSON.parse(await fs.readFile(inputFile, "utf8"));
  const parsed = (payload.messages || []).map(parseFollow).filter(Boolean);
  const seen = await existingTelegramIds();
  const newRows = parsed.filter((row) => {
    if (seen.has(row.message_id)) return false;
    seen.add(row.message_id);
    return true;
  });
  if (newRows.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.writeFile(path.join(snapshotsDir, `telegram-${stamp}-browser.csv`), toCsv(newRows, ["message_id", "datetime_utc", "alpha", "project", "x_account", "description"]), "utf8");
    await writeCounts(await allTelegramRows());
    await updateAvatarCache(newRows);
    await writeReport(newRows, payload);
  }
  console.log(`Browser Telegram parsed ${parsed.length}, new ${newRows.length}`);
  const build = spawnSync(process.execPath, [fileURLToPath(new URL("./build-site.mjs", import.meta.url))], { cwd: root, stdio: "inherit", windowsHide: true });
  if (build.status !== 0) throw new Error("Website data rebuild failed");
  if (!process.argv.includes("--local-only")) {
    const publish = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "deploy-public-silent.ps1")], { cwd: root, stdio: "inherit", windowsHide: true });
    if (publish.status !== 0) throw new Error("Website publishing failed; local records preserved. Rerun the import to retry publishing.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
