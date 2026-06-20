import { promises as fs } from "node:fs";
import path from "node:path";
import { isLikelyProject } from "./project-filter.mjs";

const root = process.cwd();
const snapshotsDir = path.join(root, "snapshots");
const reportsDir = path.join(root, "reports");
const channelUrl = "https://t.me/s/dodtwitterbot";
const jinaChannelUrl = `https://r.jina.ai/http://${channelUrl}`;

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, headers) {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n") + "\n";
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

async function readCsv(file) {
  try {
    return parseCsv(await fs.readFile(file, "utf8"));
  } catch {
    return [];
  }
}

async function listFiles(dir) {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function decodeHtml(text) {
  return String(text || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");
}

function stripTags(html) {
  return decodeHtml(
    String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function extractMessages(html) {
  const blocks = [...html.matchAll(/<div class="tgme_widget_message[^"]*"[\s\S]*?(?=<div class="tgme_widget_message|\s*<\/section>)/g)]
    .map((match) => match[0]);

  return blocks.map((block) => {
    const id = block.match(/data-post="([^"]+)"/)?.[1] || "";
    const datetime = block.match(/<time datetime="([^"]+)"/)?.[1] || "";
    const textHtml = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] || "";
    const text = stripTags(textHtml);
    const links = [...block.matchAll(/href="([^"]+)"/g)].map((match) => decodeHtml(match[1]));
    return { id, datetime, text, links };
  }).filter((message) => message.id && message.text);
}

function extractMessagesFromText(text) {
  const rows = [];
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes("[Alpha]") || !line.includes("关注")) continue;
    const nearby = lines.slice(Math.max(0, i - 3), i + 6).join(" ");
    const id = nearby.match(/dodtwitterbot\/(\d+)/)?.[0] || `jina/${Buffer.from(line).toString("base64url").slice(0, 16)}`;
    const datetime = nearby.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\+\d{2}:\d{2}|Z)/)?.[0] || new Date().toISOString();
    const links = [...nearby.matchAll(/https?:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]+/gi)].map((match) => match[0]);
    rows.push({ id, datetime, text: line, links });
  }
  return rows;
}

function handleFromLinks(links) {
  for (const link of links) {
    const match = link.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/i);
    if (match && !["intent", "share", "home"].includes(match[1].toLowerCase())) return match[1];
  }
  return "";
}

function parseFollow(message) {
  if (!message.text.includes("[Alpha]") || !message.text.includes("关注")) return null;
  const alpha = message.text.match(/\[Alpha\]\s*([^关]+?)\s*关注/)?.[1]?.trim() || "";
  const after = message.text.split("关注").slice(1).join("关注").replace(/^了\s*/, "").trim();
  const linkedHandle = handleFromLinks(message.links);
  const inlineHandle = after.match(/@([A-Za-z0-9_]+)/)?.[1] || "";
  const xAccount = linkedHandle || inlineHandle;
  let project = after
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@([A-Za-z0-9_]+)/g, "")
    .replace(/[()（）]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!project && xAccount) project = xAccount;
  if (!alpha || !project || !xAccount) return null;
  if (!isLikelyProject({ account: xAccount, project, text: message.text, strongSignal: false })) return null;
  return {
    message_id: message.id,
    datetime_utc: message.datetime,
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

  const countRows = [...grouped.values()]
    .map((item) => ({
      project: item.project,
      x_account: item.x_account,
      total_mentions: item.total_mentions,
      unique_alphas: item.alphas.size,
      first_seen_utc: item.first_seen_utc,
      last_seen_utc: item.last_seen_utc,
      status: statusFor(item.total_mentions, item.alphas.size),
    }))
    .sort((a, b) => b.total_mentions - a.total_mentions || String(a.project).localeCompare(String(b.project)));

  await fs.writeFile(
    path.join(root, "telegram_project_counts.csv"),
    toCsv(countRows, ["project", "x_account", "total_mentions", "unique_alphas", "first_seen_utc", "last_seen_utc", "status"]),
    "utf8"
  );
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
      // Saved project Twitter avatar endpoint. A later browser-authenticated pass can replace it with a resolved pbs.twimg.com URL.
      avatar_url: `https://unavatar.io/twitter/${encodeURIComponent(account)}`,
      updated_at: now,
      source: "twitter-handle",
    });
  }
  await fs.writeFile(
    file,
    toCsv([...known.values()].sort((a, b) => a.account.localeCompare(b.account)), ["account", "avatar_url", "updated_at", "source"]),
    "utf8"
  );
}

async function writeReport(newRows) {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const file = path.join(reportsDir, `${stamp}-telegram-update.md`);
  const lines = [
    `# Telegram 更新 - ${now.toLocaleString("zh-CN", { hour12: false })}`,
    "",
    `新增 TG 关注记录：${newRows.length} 条。`,
    "",
    "| 项目 | X 账号 | Alpha | 时间 |",
    "|---|---|---|---|",
    ...newRows.map((row) => `| ${row.project} | @${row.x_account} | ${row.alpha} | ${row.datetime_utc} |`),
    "",
  ];
  await fs.writeFile(file, lines.join("\n"), "utf8");
}

async function fetchTextWithRetry(urls) {
  let lastError;
  for (const url of urls) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { "user-agent": "Mozilla/5.0 AlphaMonitor/1.0" },
        });
        clearTimeout(timer);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    }
  }
  throw lastError;
}

async function writeFailureLog(error) {
  await fs.mkdir(reportsDir, { recursive: true });
  const file = path.join(reportsDir, "last-update-error.log");
  const lines = [
    `time=${new Date().toISOString()}`,
    `source=telegram`,
    `message=${error?.message || String(error)}`,
    `code=${error?.cause?.code || error?.code || ""}`,
    "",
  ];
  await fs.writeFile(file, lines.join("\n"), "utf8");
}

async function main() {
  await fs.mkdir(snapshotsDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });

  let html = "";
  try {
    html = await fetchTextWithRetry([
      channelUrl,
      jinaChannelUrl,
    ]);
  } catch (error) {
    await writeFailureLog(error);
    console.log(`Telegram fetch failed, kept existing data: ${error?.cause?.code || error.message}`);
    return;
  }
  let messages = extractMessages(html);
  if (!messages.length) messages = extractMessagesFromText(html);
  const parsed = messages.map(parseFollow).filter(Boolean);
  const seen = await existingTelegramIds();
  const newRows = parsed.filter((row) => !seen.has(row.message_id));

  if (newRows.length) {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    await fs.writeFile(
      path.join(snapshotsDir, `telegram-${stamp}.csv`),
      toCsv(newRows, ["message_id", "datetime_utc", "alpha", "project", "x_account"]),
      "utf8"
    );
    await writeCounts(await allTelegramRows(newRows));
    await updateAvatarCache(newRows);
    await writeReport(newRows);
  }

  console.log(`Telegram parsed ${parsed.length}, new ${newRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
