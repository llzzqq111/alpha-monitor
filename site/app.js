const $ = (id) => document.getElementById(id);
const state = { data: null, query: "", range: "all", day: "", loadError: "" };

function chinaTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "尚未核验";
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hourCycle: "h23" });
}

function collectionStatus(data, now = Date.now()) {
  const checked = Date.parse(data.collection?.lastCheckedAt || "");
  if (!Number.isFinite(checked)) return ["尚无成功检测记录", "status-pending"];
  if (checked > now + 300_000) return ["检测时间异常，请查看后台", "status-error"];
  if (data.collection.coverageComplete !== true) return ["最近检测未完整完成", "status-error"];
  const age = now - checked;
  if (age > 8 * 3600_000) return ["超过 8 小时未成功检测，请查看后台", "status-error"];
  if (age > 6 * 3600_000) return ["检测可能延迟，请留意更新时间", "status-delayed"];
  return ["最近检测成功 · 每 4 小时自动检测", "status-ok"];
}

function renderFreshness(data) {
  const [label, className] = state.loadError
    ? ["网站数据读取失败，当前显示可能不是最新", "status-error"]
    : collectionStatus(data);
  $("collection-status").textContent = label;
  $("collection-status").className = `collection-status ${className}`;
  const times = [
    ["最近成功检测 TG", data.collection?.lastCheckedAt, "即使没有新项目，成功检测后此时间也会更新"],
    ["已读取的最新 TG 消息", data.collection?.lastMessageAt, "实际消息时间，不是页面刷新时间"],
    ["网站数据更新时间", data.generatedAt, "本次已发布数据的生成时间"],
  ];
  $("update-times").innerHTML = times.map(([title, value, detail]) => `<div class="update-time">
    <span>${escapeHtml(title)}</span>
    <strong>${escapeHtml(chinaTime(value))}</strong>
    <small>${escapeHtml(detail)}</small>
  </div>`).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanAccount(account) {
  return String(account || "").replace(/^@/, "").trim();
}

function link(account) {
  const handle = cleanAccount(account);
  if (!handle) return "";
  return `<a href="https://x.com/${encodeURIComponent(handle)}" target="_blank" rel="noreferrer">@${escapeHtml(handle)}</a>`;
}

function avatar(account, avatarUrl = "") {
  const handle = cleanAccount(account);
  const initial = escapeHtml((handle || "?").slice(0, 1).toUpperCase());
  const src = String(avatarUrl || "").trim();
  if (!handle || !src) return `<span class="avatar avatar-fallback">${initial}</span>`;
  return `<span class="avatar-wrap">
    <span class="avatar avatar-fallback">${initial}</span>
    <img class="avatar avatar-img" src="${escapeHtml(src)}" alt="@${escapeHtml(handle)}" loading="lazy" referrerpolicy="no-referrer" onload="this.previousElementSibling.style.display='none'" onerror="this.style.display='none'">
  </span>`;
}

function projectCell(project, account, avatarUrl = "", description = "") {
  return `<div class="project-cell">
    ${avatar(account, avatarUrl)}
    <div>
      <strong>${escapeHtml(project || account || "-")}</strong>
      ${account ? `<div class="handle">${link(account)}</div>` : ""}
      ${description ? `<div class="project-description">${escapeHtml(description)}</div>` : ""}
    </div>
  </div>`;
}

function tags(items) {
  return (items || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("");
}

function statusBadge(item) {
  if (item.dayStatus === "new") return `<span class="status-new">NEW</span>`;
  if (item.dayStatus === "repeat") return `<span class="status-repeat">再次出现</span>`;
  return "";
}

function level(item) {
  const sources = item.sources || [];
  const alphaCount = (item.alphas || []).length || Number(item.unique_alphas || 0);
  const mentions = Number(item.mentions || item.total_mentions || 0);
  const score = Number(item.score || 0);
  if (sources.includes("TG") && sources.includes("X")) return ["高", "level-high"];
  if (alphaCount >= 3 || mentions >= 3 || score >= 9) return ["高", "level-high"];
  if (alphaCount >= 2 || mentions >= 2 || score >= 5) return ["中", "level-mid"];
  return ["观察", "level-watch"];
}

function levelBadge(item) {
  const [text, cls] = level(item);
  return `<span class="level ${cls}">${text}</span>`;
}

function table(headers, rows, empty = "暂无数据") {
  if (!rows.length) return `<div class="table-wrap"><p class="empty">${empty}</p></div>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function itemText(item) {
  return [
    item.project,
    item.account,
    item.x_account,
    ...(item.alphas || []),
    ...(item.tgAlphas || []),
    ...(item.xAlphas || []),
  ].join(" ").toLowerCase();
}

function itemTime(item) {
  return Date.parse(item.lastSeen || item.last_seen_utc || item.firstSeen || item.first_seen_utc || "") || 0;
}

function itemDate(item) {
  const raw = String(item.lastSeen || item.last_seen_utc || item.firstSeen || item.first_seen_utc || "");
  return raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
}

function passRange(item) {
  if (state.range === "all") return true;
  const time = itemTime(item);
  if (!time) return true;
  const hours = { "6h": 6, "24h": 24, "3d": 72 }[state.range] || Infinity;
  return Date.now() - time <= hours * 60 * 60 * 1000;
}

function passDay(item) {
  if (!state.day || state.day === "all") return true;
  return itemDate(item) === state.day;
}

function filterItems(items, source = state.source) {
  const query = state.query.trim().toLowerCase();
  return (items || []).filter((item) => {
    if (query && !itemText(item).includes(query)) return false;
    if (!passRange(item)) return false;
    if (!passDay(item)) return false;
    return true;
  });
}

function priorityItems(data) {
  return filterItems(data.projects || [])
    .map((item) => ({ ...item, levelText: level(item)[0] }))
    .filter((item) => item.levelText !== "观察")
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function populateDays(data) {
  const select = $("day");
  const daily = data.daily || [];
  const days = daily.map((group) => group.date);
  const latestWithData = daily.find((group) => Number(group.projectCount || 0) > 0 || Number(group.totalRows || 0) > 0)?.date || days[0] || "all";
  if (!state.day) state.day = latestWithData;
  const current = days.includes(state.day) || state.day === "all" ? state.day : latestWithData;
  select.innerHTML = [
    `<option value="all">全部日期</option>`,
    ...days.map((day) => `<option value="${escapeHtml(day)}">${escapeHtml(day)}</option>`),
  ].join("");
  state.day = current;
  select.value = current;
}

function projectRow(p) {
  return `<tr>
    <td>${projectCell(p.project, p.account, p.avatarUrl, p.description)}</td>
    <td>${statusBadge(p)} ${levelBadge(p)}</td>
    <td>
      ${tags((p.tgAlphas || p.alphas || []).slice(0, 8))}
    </td>
    <td class="score">${escapeHtml(p.mentions || 0)}</td>
  </tr>`;
}

function daySection(title, items, empty) {
  return `<div class="subsection">
    <h4>${escapeHtml(title)}</h4>
    ${table(["项目", "状态", "关注的 Alpha", "出现次数"], items.map(projectRow), empty)}
  </div>`;
}

function renderDaily(data) {
  const groups = state.day === "all"
    ? (data.daily || []).slice(0, 7)
    : (data.daily || []).filter((group) => group.date === state.day);

  $("daily").innerHTML = groups.map((group) => {
    const projects = (group.projects || []).filter((item) => {
      const query = state.query.trim().toLowerCase();
      if (query && !itemText(item).includes(query)) return false;
      return true;
    });
    const repeatItems = projects.filter((item) => Number(item.mentions || 0) >= 2);
    const singleItems = projects.filter((item) => Number(item.mentions || 0) < 2);
    return `<div class="day-block">
      <div class="day-title">
        <h3>${escapeHtml(group.date)}</h3>
        <span>${escapeHtml(group.projectCount)} 个项目 · 本日多次出现 ${escapeHtml(repeatItems.length)} · 跨日再现 ${escapeHtml(group.repeatCount || 0)}</span>
      </div>
      ${daySection("本日多次出现 / 多 Alpha 关注", repeatItems, "这一天暂无多次出现项目")}
      ${daySection("本日单次出现项目", singleItems, "这一天暂无单次出现项目")}
    </div>`;
  }).join("") || `<div class="table-wrap"><p class="empty">暂无日期数据</p></div>`;
}

function render() {
  const data = state.data;
  if (!data) return;

  populateDays(data);

  const priority = priorityItems(data);
  const tg = filterItems(data.tgPriority || []);

  renderFreshness(data);
  $("meta").textContent = state.loadError
    ? `加载失败：${state.loadError}。已保留上次显示的数据，请稍后重试。`
    : "来源：dodtwitterbot 公开频道。页面每 10 分钟获取已发布数据；刷新网站数据不会立即触发 TG 采集。";
  $("totals").innerHTML = [
    ["总项目", data.totals.projects],
    ["当前重点", priority.length],
    ["TG 有效记录", data.totals.telegramRows],
  ].map(([label, value]) => `<div class="card"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("");

  $("priority").innerHTML = table(
    ["项目", "等级", "关注的 Alpha", "出现次数"],
    priority.slice(0, 30).map((p) => `<tr>
      <td>${projectCell(p.project, p.account, p.avatarUrl, p.description)}</td>
      <td>${levelBadge(p)}</td>
      <td>${tags((p.alphas || []).slice(0, 10))}</td>
      <td class="score">${escapeHtml(p.mentions || 0)}</td>
    </tr>`)
  );

  renderDaily(data);

  $("tg").innerHTML = table(
    ["项目简介", "关注的 Alpha", "TG 出现次数", "热度"],
    tg.map((p) => `<tr>
      <td>${projectCell(p.project, p.x_account, p.avatarUrl, p.description)}</td>
      <td>${tags(p.alphas || [])}</td>
      <td class="score">${escapeHtml(p.total_mentions)}</td>
      <td>${levelBadge(p)}</td>
    </tr>`)
  );

  $("reports").innerHTML = table(
    ["报告", "更新时间"],
    (data.reports || []).slice(0, 12).map((r) => `<tr>
      <td>${escapeHtml(r.title)}</td>
      <td>${new Date(r.updatedAt).toLocaleString()}</td>
    </tr>`)
  );
}

async function load() {
  const res = await fetch(`./data.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`网站数据请求失败（HTTP ${res.status}）`);
  state.data = await res.json();
  state.loadError = "";
  render();
}

function reload() {
  return load().catch((error) => {
    state.loadError = error.message;
    $("meta").textContent = `加载失败：${error.message}。已保留上次显示的数据，请稍后重试。`;
    $("collection-status").textContent = "网站数据读取失败，当前显示可能不是最新";
    $("collection-status").className = "collection-status status-error";
  });
}

$("refresh").addEventListener("click", reload);
$("search").addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});
$("range").addEventListener("change", (event) => {
  state.range = event.target.value;
  render();
});
$("day").addEventListener("change", (event) => {
  state.day = event.target.value;
  render();
});

reload();
setInterval(reload, 600_000);
