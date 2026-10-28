import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isLikelyProject } from "./project-filter.mjs";
import { parseCsv } from "./csv.mjs";

const root = process.cwd();
const snapshotsDir = path.join(root, "snapshots");
const reportsDir = path.join(root, "reports");
const channelUrl = "https://t.me/s/dodtwitterbot";
const collectionStateFile = path.join(root, "collection-state.json");

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
      .replace(/[^\S\r\n]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim()
  );
}

function extractMessages(html) {
  const starts = [...html.matchAll(/<div\b[^>]*\bdata-post="[^"]+"[^>]*>/g)];
  const blocks = starts.map((match, index) => html.slice(match.index, starts[index + 1]?.index ?? html.length));

  return blocks.map((block) => {
    const id = block.match(/data-post="([^"]+)"/)?.[1] || "";
    const datetime = block.match(/<time\b[^>]*datetime="([^"]+)"/)?.[1] || "";
    const textHtml = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] || "";
    const text = stripTags(textHtml);
    const links = [...block.matchAll(/href="([^"]+)"/g)].map((match) => decodeHtml(match[1]));
    return { id, datetime, text, links };
  }).filter((message) => /^dodtwitterbot\/\d+$/.test(message.id));
}

function extractMessagesFromText(text) {
  const rows = [];
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes("[Alpha]") || !line.includes("关注")) continue;
    const nearby = lines.slice(Math.max(0, i - 3), i + 6).join(" ");
    const id = nearby.match(/dodtwitterbot\/(\d+)/)?.[0] || `jina/${Buffer.from(line).toString("base64url").slice(0, 16)}`;
    const datetime = nearby.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\+\d{2}:\d{2}|Z)/)?.[0] || "";
    const links = [...nearby.matchAll(/https?:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]+/gi)].map((match) => match[0]);
    rows.push({ id, datetime, text: line, links });
  }
  return rows;
}

function handleFromLinks(links) {
  for (const link of [...links].reverse()) {
    const match = String(link).match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/?(?:\?[^#]*)?$/i);
    if (match && !["intent", "share", "home"].includes(match[1].toLowerCase())) return match[1];
  }
  return "";
}

function parseFollow(message) {
  if (!message.text.includes("[Alpha]") || !message.text.includes("关注")) return null;
  if (!message.datetime || !Number.isFinite(Date.parse(message.datetime))) return null;
  const follow = message.text.match(/\[Alpha\]\s*(.+?)\s*关注(?:了)?\s*(.+)/);
  const alpha = follow?.[1]?.trim() || "";
  const after = (follow?.[2] || "").split(/(?:用户简介|简介|bio|description)\s*[:：]/i)[0].trim();
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
  const description = message.text.match(/(?:用户简介|简介|bio|description)[ \t]*[:：][ \t]*([\s\S]*?)(?=\n[ \t]*(?:你关注的|X:|https?:\/\/)|$)/i)?.[1]?.trim() || "";
  if (!description || !isLikelyProject({ account: xAccount, project, text: description, strongSignal: false })) return null;
  return {
    message_id: normalizeTelegramId(message.id),
    datetime_utc: message.datetime,
    alpha,
    project,
    x_account: xAccount,
    description,
  };
}

function normalizeTelegramId(value) {
  const id = String(value || "").match(/dodtwitterbot\/(\d+)/)?.[1];
  return id ? `dodtwitterbot/${id}` : String(value || "");
}

function decodeAttribute(value) {
  return decodeHtml(String(value || "")).replace(/\s+/g, " ").trim();
}

function bioFromProfileHtml(html) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = tag.match(/(?:name|property)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (!new Set(["description", "og:description", "twitter:description"]).has(name)) continue;
    const content = tag.match(/content=["']([^"']*)["']/i)?.[1] || "";
    const description = decodeAttribute(content);
    if (description.length < 20 || /log in|sign up|posts by|see .* posts/i.test(description)) continue;
    return description.slice(0, 500);
  }
  return "";
}

async function fetchProfileBio(account) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://x.com/${encodeURIComponent(account)}`, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 AlphaMonitor/1.0" },
    });
    if (!response.ok) return "";
    return bioFromProfileHtml(await response.text());
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function fillMissingDescriptions(rows) {
  const byAccount = new Map();
  for (const row of rows) {
    const account = String(row.x_account || "").replace(/^@/, "").trim();
    if (account && row.description && !byAccount.has(account.toLowerCase())) {
      byAccount.set(account.toLowerCase(), row.description);
    }
  }
  const accounts = [...new Set(rows.map((row) => String(row.x_account || "").replace(/^@/, "").trim()).filter(Boolean))];
  for (let i = 0; i < accounts.length; i += 4) {
    await Promise.all(accounts.slice(i, i + 4).map(async (account) => {
      const key = account.toLowerCase();
      if (!byAccount.has(key)) byAccount.set(key, await fetchProfileBio(account));
    }));
  }
  for (const row of rows) {
    if (!row.description) row.description = byAccount.get(String(row.x_account || "").replace(/^@/, "").trim().toLowerCase()) || "";
  }
}

async function existingTelegramIds() {
  const ids = new Set();
  for (const file of await listFiles(snapshotsDir)) {
    if (!file.startsWith("telegram-") || !file.endsWith(".csv")) continue;
    for (const row of await readCsv(path.join(snapshotsDir, file))) {
      if (row.message_id) ids.add(normalizeTelegramId(row.message_id));
    }
  }
  return ids;
}

async function allTelegramRows() {
  const rows = new Map();
  for (const file of await listFiles(snapshotsDir)) {
    if (!file.startsWith("telegram-") || !file.endsWith(".csv")) continue;
    for (const row of await readCsv(path.join(snapshotsDir, file))) {
      const key = row.message_id ? normalizeTelegramId(row.message_id) : JSON.stringify(row);
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

  const countRows = [...grouped.values()]
    .map((item) => ({
      project: item.project,
      x_account: item.x_account,
      total_mentions: item.total_mentions,
      unique_alphas: item.alphas.size,
      alpha_names: [...item.alphas].sort().join("; "),
      description: item.description,
      first_seen_utc: item.first_seen_utc,
      last_seen_utc: item.last_seen_utc,
      status: statusFor(item.total_mentions, item.alphas.size),
    }))
    .sort((a, b) => b.total_mentions - a.total_mentions || String(a.project).localeCompare(String(b.project)));

  await fs.writeFile(
    path.join(root, "telegram_project_counts.csv"),
    toCsv(countRows, ["project", "x_account", "total_mentions", "unique_alphas", "first_seen_utc", "last_seen_utc", "status", "alpha_names", "description"]),
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
    if (!account || known.has(account.toLowerCase()) || !/^https:\/\//.test(row.avatar_url || "")) continue;
    known.set(account.toLowerCase(), {
      account,
      avatar_url: row.avatar_url,
      updated_at: now,
      source: "telegram-project-image",
    });
  }
  if (known.size === current.length) return;
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

async function fetchTextWithRetry(url) {
  let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { "user-agent": "Mozilla/5.0 AlphaMonitor/1.0" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        clearTimeout(timer);
        return text;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    }
  throw lastError;
}

function numericMessageId(message) {
  return Number(String(message.id || "").match(/^dodtwitterbot\/(\d+)$/)?.[1] || 0);
}

async function collectSince(cursor, fetchPage = fetchTextWithRetry, maxPages = 250) {
  if (!Number.isSafeInteger(cursor) || cursor <= 0) throw new Error("A verified Telegram message checkpoint is required");
  const collected = new Map();
  let before = null;
  let latest;
  for (let pages = 1; pages <= maxPages; pages += 1) {
    const url = new URL(channelUrl);
    if (before) url.searchParams.set("before", String(before));
    const page = extractMessages(await fetchPage(url.href));
    if (!page.length) throw new Error("Telegram page is unreadable or history is incomplete; checkpoint was not advanced");
    for (const message of page) {
      if (!message.datetime || !Number.isFinite(Date.parse(message.datetime))) throw new Error(`Telegram message ${message.id} has no verifiable date`);
      const id = numericMessageId(message);
      if (!latest || id > numericMessageId(latest)) latest = message;
      if (id > cursor) collected.set(id, message);
    }
    const oldest = Math.min(...page.map(numericMessageId));
    if (oldest <= cursor) {
      if (numericMessageId(latest) < cursor) throw new Error("Telegram returned an older cached page; freshness could not be verified");
      return { messages: [...collected.values()].sort((a, b) => numericMessageId(a) - numericMessageId(b)), latest, pages };
    }
    if (before && oldest >= before) throw new Error("Telegram history pagination did not progress; checkpoint was not advanced");
    before = oldest;
  }
  throw new Error(`Telegram history exceeded ${maxPages} pages; checkpoint was not advanced`);
}

async function readCheckpoint() {
  try {
    const state = JSON.parse(await fs.readFile(collectionStateFile, "utf8"));
    if (state.channel !== "dodtwitterbot") throw new Error("Unexpected Telegram checkpoint channel");
    return Number(state.lastMessageId);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const ids = [...await existingTelegramIds()].map((id) => Number(id.match(/^dodtwitterbot\/(\d+)$/)?.[1] || 0));
    return Math.max(0, ...ids);
  }
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

  const cursor = await readCheckpoint();
  let collection;
  try {
    collection = await collectSince(cursor);
  } catch (error) {
    await writeFailureLog(error);
    console.log(`Telegram fetch failed, kept existing data: ${error?.cause?.code || error.message}`);
    process.exitCode = 2;
    return;
  }
  const messages = collection.messages;
  const parsed = messages.map(parseFollow).filter(Boolean);
  const seen = await existingTelegramIds();
  const newRows = parsed.filter((row) => {
    if (seen.has(row.message_id)) return false;
    seen.add(row.message_id);
    return true;
  });

  if (newRows.length) {
    await fillMissingDescriptions(newRows);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.writeFile(
      path.join(snapshotsDir, `telegram-${stamp}.csv`),
      toCsv(newRows, ["message_id", "datetime_utc", "alpha", "project", "x_account", "description"]),
      { encoding: "utf8", flag: "wx" }
    );
    await writeCounts(await allTelegramRows());
    await updateAvatarCache(newRows);
    await writeReport(newRows);
  }

  await fs.writeFile(collectionStateFile, JSON.stringify({
    channel: "dodtwitterbot",
    lastMessageId: numericMessageId(collection.latest),
    lastMessageAt: collection.latest.datetime,
    lastCheckedAt: new Date().toISOString(),
    previousMessageId: cursor,
    pagesRead: collection.pages,
    messagesRead: messages.length,
    newProjectRecords: newRows.length,
    coverageComplete: true,
    mode: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
  }, null, 2) + "\n", "utf8");

  console.log(`Telegram parsed ${parsed.length}, new ${newRows.length}`);
}

export { extractMessages, parseFollow, collectSince };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
