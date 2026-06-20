const $ = (id) => document.getElementById(id);
const state = { data: null, query: "", range: "all", source: "all", day: "" };

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

function projectCell(project, account, avatarUrl = "") {
  return `<div class="project-cell">
    ${avatar(account, avatarUrl)}
    <div>
      <strong>${escapeHtml(project || account || "-")}</strong>
      ${account ? `<div class="handle">${link(account)}</div>` : ""}
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

function passSource(item, required = state.source) {
  if (required === "all") return true;
  const sources = item.sources || [];
  if (required === "cross") return sources.includes("TG") && sources.includes("X");
  if (required === "tg") return sources.includes("TG") || item.x_account;
  if (required === "x") return sources.includes("X") || item.account;
  return true;
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
    if (!passSource(item, source)) return false;
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
    <td>${projectCell(p.project, p.account, p.avatarUrl)}</td>
    <td>${statusBadge(p)} ${levelBadge(p)}</td>
    <td>${tags(p.sources)}</td>
    <td>
      ${p.tgAlphas?.length ? `<div class="source-line">TG：${tags(p.tgAlphas.slice(0, 8))}</div>` : ""}
      ${p.xAlphas?.length ? `<div class="source-line">X：${tags(p.xAlphas.slice(0, 8))}</div>` : tags((p.alphas || []).slice(0, 8))}
    </td>
    <td class="score">${escapeHtml(p.score || p.mentions || "")}</td>
  </tr>`;
}

function daySection(title, items, empty) {
  return `<div class="subsection">
    <h4>${escapeHtml(title)}</h4>
    ${table(["项目", "状态", "来源", "Alpha", "强度"], items.slice(0, 20).map(projectRow), empty)}
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
      if (!passSource(item)) return false;
      return true;
    });
    const newItems = projects.filter((item) => item.dayStatus === "new");
    const repeatItems = projects.filter((item) => item.dayStatus === "repeat");
    const crossItems = projects.filter((item) => (item.sources || []).includes("TG") && (item.sources || []).includes("X"));

    return `<div class="day-block">
      <div class="day-title">
        <h3>${escapeHtml(group.date)}</h3>
        <span>${escapeHtml(group.projectCount)} 个项目 · 新增 ${escapeHtml(group.newCount || 0)} · 再次出现 ${escapeHtml(group.repeatCount || 0)} · 双来源 ${escapeHtml(group.crossSource)}</span>
      </div>
      ${daySection("今日新增项目", newItems, "这一天暂无新增项目")}
      ${daySection("今日重复出现 / 多 Alpha 关注", repeatItems, "这一天暂无重复出现项目")}
      ${daySection("今日 TG + X 双来源", crossItems, "这一天暂无双来源项目")}
    </div>`;
  }).join("") || `<div class="table-wrap"><p class="empty">暂无日期数据</p></div>`;
}

function render() {
  const data = state.data;
  if (!data) return;

  populateDays(data);

  const priority = priorityItems(data);
  const cross = filterItems(data.crossSource || [], "cross");
  const tg = filterItems(data.tgPriority || [], state.source === "x" ? "x" : "tg");
  const xmulti = filterItems(data.xMultiAlpha || [], state.source === "tg" ? "tg" : "x");

  $("meta").textContent = `最后生成：${new Date(data.generatedAt).toLocaleString()}，页面每 10 分钟自动刷新`;
  $("totals").innerHTML = [
    ["总项目", data.totals.projects],
    ["当前重点", priority.length],
    ["TG 记录", data.totals.telegramRows],
    ["X 记录", data.totals.xRows],
    ["双来源项目", data.totals.crossSource],
  ].map(([label, value]) => `<div class="card"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("");

  $("priority").innerHTML = table(
    ["项目", "等级", "来源", "Alpha", "强度"],
    priority.slice(0, 30).map((p) => `<tr>
      <td>${projectCell(p.project, p.account, p.avatarUrl)}</td>
      <td>${levelBadge(p)}</td>
      <td>${tags(p.sources)}</td>
      <td>${tags((p.alphas || []).slice(0, 10))}</td>
      <td class="score">${escapeHtml(p.score || p.mentions || "")}</td>
    </tr>`)
  );

  renderDaily(data);

  $("cross").innerHTML = table(
    ["项目", "等级", "来源", "TG Alpha", "X Alpha", "强度"],
    cross.slice(0, 20).map((p) => `<tr>
      <td>${projectCell(p.project, p.account, p.avatarUrl)}</td>
      <td>${levelBadge(p)}</td>
      <td>${tags(p.sources)}</td>
      <td>${tags((p.tgAlphas || []).slice(0, 8))}</td>
      <td>${tags((p.xAlphas || []).slice(0, 8))}</td>
      <td class="score">${escapeHtml(p.score)}</td>
    </tr>`)
  );

  $("tg").innerHTML = table(
    ["项目", "等级", "累计次数", "状态"],
    tg.slice(0, 20).map((p) => `<tr>
      <td>${projectCell(p.project, p.x_account, p.avatarUrl)}</td>
      <td>${levelBadge(p)}</td>
      <td class="score">${escapeHtml(p.total_mentions)}</td>
      <td>${escapeHtml(p.status)}</td>
    </tr>`)
  );

  $("xmulti").innerHTML = table(
    ["项目", "等级", "Alpha 数", "Alpha"],
    xmulti.slice(0, 30).map((p) => `<tr>
      <td>${projectCell(p.project, p.account, p.avatarUrl)}</td>
      <td>${levelBadge(p)}</td>
      <td class="score">${escapeHtml((p.alphas || []).length)}</td>
      <td>${tags((p.alphas || []).slice(0, 10))}</td>
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
  state.data = await res.json();
  render();
}

$("refresh").addEventListener("click", load);
$("search").addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});
$("range").addEventListener("change", (event) => {
  state.range = event.target.value;
  render();
});
$("source").addEventListener("change", (event) => {
  state.source = event.target.value;
  render();
});
$("day").addEventListener("change", (event) => {
  state.day = event.target.value;
  render();
});

load().catch((error) => {
  $("meta").textContent = `加载失败：${error.message}`;
});
setInterval(load, 600_000);
