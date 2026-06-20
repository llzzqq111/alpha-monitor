import { promises as fs } from "node:fs";
import path from "node:path";
import { isLikelyProject } from "./project-filter.mjs";

const root = process.cwd();
const snapshotsDir = path.join(root, "snapshots");
const reportsDir = path.join(root, "reports");
const siteDir = path.join(root, "site");
const hiddenAccounts = new Set([
  "vladtenev",
  "huawei",
  "tencentglobal",
  "bydcompany",
  "djiglobal",
  "autodesk",
  "imperialcollege",
  "spacex",
  "ethglobal",
  "uniswapbuilders",
  "mixpanel",
  "relayprotocol",
  "aztecfnd",
  "gopoversight",
  "fxshaw",
]);
const hiddenWords = [
  "founder",
  "ceo",
  "co-founder",
  "engineer",
  "attorney",
  "advisor",
  "investor",
  "teacher",
  "university",
  "official twitter",
  "support",
  "photographer",
  "marketing",
  "personal",
  "kol",
  "influencer",
  "official",
];
const positiveWords = [
  "agent",
  "agents",
  "payment",
  "payments",
  "v4",
  "hook",
  "hooks",
  "launchpad",
  "onchain",
  "solana",
  "base",
  "bitcoin l1",
  "mmo",
  "game",
  "protocol",
  "infra",
  "infrastructure",
  "stablecoin",
  "perp",
  "market",
  "markets",
  "zk",
  "privacy",
  "defai",
  "robot",
  "robotics",
];

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines.shift().split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
}

async function readCsv(file) {
  return parseCsv(await fs.readFile(file, "utf8"));
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

function projectFromTelegram(row) {
  return {
    source: "TG",
    project: row.project,
    account: row.x_account,
    alpha: row.alpha,
    seenAt: row.datetime_utc,
    messageId: row.message_id,
    text: row.description || "",
  };
}

function keyAccount(account) {
  return String(account || "").replace(/^@/, "").trim().toLowerCase();
}

function projectFromX(row, file) {
  return {
    source: "X",
    project: row.followed_account,
    account: row.followed_account,
    alpha: row.alpha_account,
    seenAt: file.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "",
    messageId: file,
    text: row.description || row.bio || "",
  };
}

function scoreRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = (row.account || row.project || "").toLowerCase();
    if (!key) continue;
    if (!grouped.has(key)) {
      grouped.set(key, {
        project: row.project,
        account: row.account,
        sources: new Set(),
        alphas: new Set(),
        tgAlphas: new Set(),
        xAlphas: new Set(),
        mentions: 0,
        firstSeen: row.seenAt,
        lastSeen: row.seenAt,
      rows: [],
      text: "",
    });
    }
    const item = grouped.get(key);
    item.sources.add(row.source);
    if (row.alpha) item.alphas.add(row.alpha);
    if (row.alpha && row.source === "TG") item.tgAlphas.add(row.alpha);
    if (row.alpha && row.source === "X") item.xAlphas.add(row.alpha);
    item.mentions += 1;
    if (row.seenAt && (!item.firstSeen || row.seenAt < item.firstSeen)) item.firstSeen = row.seenAt;
    if (row.seenAt && (!item.lastSeen || row.seenAt > item.lastSeen)) item.lastSeen = row.seenAt;
    item.rows.push(row);
    item.text += ` ${row.project || ""} ${row.account || ""} ${row.text || ""}`;
  }
  return [...grouped.values()]
    .map((item) => ({
      ...item,
      sources: [...item.sources].sort(),
      alphas: [...item.alphas].sort(),
      tgAlphas: [...item.tgAlphas].sort(),
      xAlphas: [...item.xAlphas].sort(),
      score: item.mentions + item.alphas.size + (item.sources.length > 1 ? 5 : 0),
    }))
    .filter(shouldShowProject)
    .sort((a, b) => b.score - a.score || b.mentions - a.mentions || a.project.localeCompare(b.project));
}

function rowDate(row) {
  const value = String(row.seenAt || row.messageId || "");
  return value.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "unknown";
}

function dailyGroups(rows, avatarByAccount) {
  const groups = new Map();
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  groups.set(today, []);
  for (const row of rows) {
    const day = rowDate(row);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(row);
  }
  const firstSeenByAccount = new Map();
  for (const row of rows) {
    const key = keyAccount(row.account || row.project);
    const date = rowDate(row);
    if (!key || date === "unknown") continue;
    const prev = firstSeenByAccount.get(key);
    if (!prev || date < prev) firstSeenByAccount.set(key, date);
  }

  return [...groups.entries()]
    .map(([date, dateRows]) => {
      const projects = scoreRows(dateRows).map((item) => ({
        ...item,
        avatarUrl: avatarByAccount.get(keyAccount(item.account)) || "",
        dayStatus: firstSeenByAccount.get(keyAccount(item.account)) === date ? "new" : "repeat",
      }));
      return {
        date,
        totalRows: dateRows.length,
        projectCount: projects.length,
        crossSource: projects.filter((item) => item.sources.includes("TG") && item.sources.includes("X")).length,
        newCount: projects.filter((item) => item.dayStatus === "new").length,
        repeatCount: projects.filter((item) => item.dayStatus === "repeat").length,
        projects: projects.slice(0, 40),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function shouldShowProject(item) {
  const account = String(item.account || "").toLowerCase();
  const text = `${item.project || ""} ${item.account || ""} ${item.text || ""}`.toLowerCase();
  const sourceCount = Array.isArray(item.sources) ? item.sources.length : item.sources.size;
  const alphaCount = Array.isArray(item.alphas) ? item.alphas.length : item.alphas.size;
  const strongSignal = sourceCount > 1 || alphaCount >= 2 || item.mentions >= 2;
  return isLikelyProject({ account, project: item.project, text, strongSignal });
}

async function main() {
  await fs.mkdir(siteDir, { recursive: true });

  const snapshotFiles = await listFiles(snapshotsDir);
  const reportFiles = await listFiles(reportsDir);
  const telegramRows = [];
  const xRows = [];

  for (const file of snapshotFiles) {
    const full = path.join(snapshotsDir, file);
    if (file.startsWith("telegram-") && file.endsWith(".csv")) {
      telegramRows.push(...(await readCsv(full)).map(projectFromTelegram));
    } else if (file.includes("x-partial") && file.endsWith(".csv")) {
      xRows.push(...(await readCsv(full)).map((row) => projectFromX(row, file)));
    }
  }

  let counts = [];
  try {
    counts = await readCsv(path.join(root, "telegram_project_counts.csv"));
  } catch {
    counts = [];
  }

  let avatarRows = [];
  try {
    avatarRows = await readCsv(path.join(root, "avatar_cache.csv"));
  } catch {
    avatarRows = [];
  }
  const avatarByAccount = new Map(
    avatarRows
      .filter((row) => row.account && row.avatar_url)
      .map((row) => [keyAccount(row.account), row.avatar_url])
  );

  const allRows = [...telegramRows, ...xRows];
  const projects = scoreRows(allRows).map((item) => ({
    ...item,
    avatarUrl: avatarByAccount.get(keyAccount(item.account)) || "",
  }));
  const crossSource = projects.filter((item) => item.sources.includes("TG") && item.sources.includes("X"));
  const xMultiAlpha = projects.filter((item) => item.sources.includes("X") && item.alphas.length >= 2);
  const tgPriority = counts
    .map((row) => ({
      ...row,
      total_mentions: Number(row.total_mentions || 0),
      avatarUrl: avatarByAccount.get(keyAccount(row.x_account)) || "",
    }))
    .filter((row) => {
      const account = String(row.x_account || "").toLowerCase();
      const text = `${row.project || ""} ${row.x_account || ""}`.toLowerCase();
      return isLikelyProject({
        account,
        project: row.project,
        text,
        strongSignal: row.total_mentions >= 2 || Number(row.unique_alphas || 0) >= 2,
      });
    })
    .sort((a, b) => b.total_mentions - a.total_mentions || a.project.localeCompare(b.project));

  const reports = await Promise.all(reportFiles.map(async (file) => ({
    file,
    title: file.replace(/\.md$/, ""),
    updatedAt: (await fs.stat(path.join(reportsDir, file))).mtime.toISOString(),
  })));

  const data = {
    generatedAt: new Date().toISOString(),
    totals: {
      telegramRows: telegramRows.length,
      xRows: xRows.length,
      projects: projects.length,
      crossSource: crossSource.length,
    },
    projects,
    crossSource,
    xMultiAlpha,
    tgPriority,
    daily: dailyGroups(allRows, avatarByAccount),
    reports: reports.sort((a, b) => b.file.localeCompare(a.file)),
  };

  await fs.writeFile(path.join(siteDir, "data.json"), JSON.stringify(data, null, 2), "utf8");
  for (const file of ["index.html", "app.js", "styles.css"]) {
    await fs.copyFile(path.join(siteDir, file), path.join(root, file));
  }
  await fs.copyFile(path.join(siteDir, "data.json"), path.join(root, "data.json"));
  console.log(`Built site/data.json with ${projects.length} projects`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});




