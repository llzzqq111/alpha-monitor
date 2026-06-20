import { promises as fs } from "node:fs";
import path from "node:path";
import { isLikelyProject } from "./project-filter.mjs";

const root = process.cwd();
const snapshotsDir = path.join(root, "snapshots");
const reportsDir = path.join(root, "reports");
const inputFile = path.join(root, "browser-telegram-current.json");

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, headers) {
  return [headers.join(","), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))].join("\n") + "\n";
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines.shift());
  return lines.map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
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

function handleFromLinks(links = []) {
  for (const link of links) {
    const match = String(link).match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/i);
    if (match && !["intent", "share", "home"].includes(match[1].toLowerCase())) return match[1];
  }
  return "";
}

function parseFollow(message) {
  const text = String(message.text || "");
  if (!text.includes("[Alpha]") || !text.includes("关注")) return null;
  const alpha = text.match(/\[Alpha\]\s*([^关]+?)\s*关注/)?.[1]?.trim() || "";
  const after = text.split("关注").slice(1).join("关注").replace(/^了\s*/, "").split("\n")[0].trim();
  const xAccount = handleFromLinks(message.links);
  let project = after.replace(/@([A-Za-z0-9_]+)/g, "").replace(/\s+/g, " ").trim();
  if (!project && xAccount) project = xAccount;
  if (!alpha || !project || !xAccount) return null;
  if (!isLikelyProject({ account: xAccount, project, text, strongSignal: false })) return null;
  return {
    message_id: message.id,
    datetime_utc: message.time,
    alpha,
    project,
    x_account: xAccount,
  };
}

async function existingTelegramIds() {
  const ids = new Set();
  for (const file of await listFiles(snapshotsDir)) {
    if (!file.startsWith("telegram-") || !file.endsWith(".csv")) continue;
    for (const row of await readCsv(path.join(snapshotsDir, file))) {
      if (row.message_id) ids.add(row.message_id);
    }
  }
  return ids;
}

async function allTelegramRows(extraRows = []) {
  const rows = [];
  for (const file of await listFiles(snapshotsDir)) {
    if (!file.startsWith("telegram-") || !file.endsWith(".csv")) continue;
    rows.push(...await readCsv(path.join(snapshotsDir, file)));
  }
  rows.push(...extraRows);
  return rows;
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
      });
    }
    const item = grouped.get(key);
    item.total_mentions += 1;
    if (row.alpha) item.alphas.add(row.alpha);
    if (row.datetime_utc && (!item.first_seen_utc || row.datetime_utc < item.first_seen_utc)) item.first_seen_utc = row.datetime_utc;
    if (row.datetime_utc && (!item.last_seen_utc || row.datetime_utc > item.last_seen_utc)) item.last_seen_utc = row.datetime_utc;
  }
  const countRows = [...grouped.values()].map((item) => ({
    project: item.project,
    x_account: item.x_account,
    total_mentions: item.total_mentions,
    unique_alphas: item.alphas.size,
    first_seen_utc: item.first_seen_utc,
    last_seen_utc: item.last_seen_utc,
    status: statusFor(item.total_mentions, item.alphas.size),
  })).sort((a, b) => b.total_mentions - a.total_mentions || String(a.project).localeCompare(String(b.project)));
  await fs.writeFile(path.join(root, "telegram_project_counts.csv"), toCsv(countRows, ["project", "x_account", "total_mentions", "unique_alphas", "first_seen_utc", "last_seen_utc", "status"]), "utf8");
}

async function updateAvatarCache(rows) {
  const file = path.join(root, "avatar_cache.csv");
  const current = await readCsv(file);
  const known = new Map(current.filter((row) => row.account).map((row) => [row.account.toLowerCase(), row]));
  const now = new Date().toISOString();
  for (const row of rows) {
    const account = String(row.x_account || "").replace(/^@/, "").trim();
    if (!account || known.has(account.toLowerCase())) continue;
    known.set(account.toLowerCase(), {
      account,
      avatar_url: `https://unavatar.io/twitter/${encodeURIComponent(account)}`,
      updated_at: now,
      source: "browser-tg",
    });
  }
  await fs.writeFile(file, toCsv([...known.values()].sort((a, b) => a.account.localeCompare(b.account)), ["account", "avatar_url", "updated_at", "source"]), "utf8");
}

async function writeReport(newRows) {
  if (!newRows.length) return;
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const lines = [
    `# Browser Telegram 更新 - ${now.toLocaleString("zh-CN", { hour12: false })}`,
    "",
    `新增 TG 关注记录：${newRows.length} 条。`,
    "",
    "| 项目 | X 账号 | Alpha | 时间 |",
    "|---|---|---|---|",
    ...newRows.map((row) => `| ${row.project} | @${row.x_account} | ${row.alpha} | ${row.datetime_utc} |`),
    "",
  ];
  await fs.writeFile(path.join(reportsDir, `${stamp}-telegram-browser.md`), lines.join("\n"), "utf8");
}

async function main() {
  await fs.mkdir(snapshotsDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });
  const payload = JSON.parse(await fs.readFile(inputFile, "utf8"));
  const parsed = (payload.messages || []).map(parseFollow).filter(Boolean);
  const seen = await existingTelegramIds();
  const newRows = parsed.filter((row) => !seen.has(row.message_id));
  if (newRows.length) {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    await fs.writeFile(path.join(snapshotsDir, `telegram-${stamp}-browser.csv`), toCsv(newRows, ["message_id", "datetime_utc", "alpha", "project", "x_account"]), "utf8");
    await writeCounts(await allTelegramRows(newRows));
    await updateAvatarCache(newRows);
    await writeReport(newRows);
  }
  console.log(`Browser Telegram parsed ${parsed.length}, new ${newRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
