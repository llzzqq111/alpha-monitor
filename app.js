const $ = (id) => document.getElementById(id);

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

function avatar(account) {
  const handle = cleanAccount(account);
  const initial = escapeHtml((handle || "?").slice(0, 1).toUpperCase());
  if (!handle) return `<span class="avatar avatar-fallback">${initial}</span>`;
  const src = `https://unavatar.io/twitter/${encodeURIComponent(handle)}`;
  return `<span class="avatar-wrap">
    <span class="avatar avatar-fallback">${initial}</span>
    <img class="avatar avatar-img" src="${src}" alt="@${escapeHtml(handle)}" loading="lazy" referrerpolicy="no-referrer" onload="this.previousElementSibling.style.display='none'" onerror="this.style.display='none'">
  </span>`;
}

function projectCell(project, account) {
  return `<div class="project-cell">
    ${avatar(account)}
    <div>
      <strong>${escapeHtml(project || account || "-")}</strong>
      ${account ? `<div class="handle">${link(account)}</div>` : ""}
    </div>
  </div>`;
}

function tags(items) {
  return (items || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("");
}

function table(headers, rows, empty = "暂无数据") {
  if (!rows.length) return `<div class="table-wrap"><p class="empty">${empty}</p></div>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

async function load() {
  const res = await fetch(`./data.json?t=${Date.now()}`);
  const data = await res.json();

  $("meta").textContent = `最后生成：${new Date(data.generatedAt).toLocaleString()}，页面每 10 分钟自动刷新`;
  $("totals").innerHTML = [
    ["筛选后项目", data.totals.projects],
    ["TG 记录", data.totals.telegramRows],
    ["X 记录", data.totals.xRows],
    ["双来源项目", data.totals.crossSource],
  ].map(([label, value]) => `<div class="card"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("");

  $("cross").innerHTML = table(
    ["项目", "来源", "TG Alpha", "X Alpha", "强度"],
    data.crossSource.slice(0, 20).map((p) => `<tr>
      <td>${projectCell(p.project, p.account)}</td>
      <td>${tags(p.sources)}</td>
      <td>${tags((p.tgAlphas || []).slice(0, 8))}</td>
      <td>${tags((p.xAlphas || []).slice(0, 8))}</td>
      <td class="score">${escapeHtml(p.score)}</td>
    </tr>`)
  );

  $("tg").innerHTML = table(
    ["项目", "累计次数", "状态"],
    data.tgPriority.slice(0, 20).map((p) => `<tr>
      <td>${projectCell(p.project, p.x_account)}</td>
      <td class="score">${escapeHtml(p.total_mentions)}</td>
      <td>${escapeHtml(p.status)}</td>
    </tr>`)
  );

  $("xmulti").innerHTML = table(
    ["项目", "Alpha 数", "Alpha"],
    data.xMultiAlpha.slice(0, 30).map((p) => `<tr>
      <td>${projectCell(p.project, p.account)}</td>
      <td class="score">${escapeHtml(p.alphas.length)}</td>
      <td>${tags(p.alphas.slice(0, 10))}</td>
    </tr>`)
  );

  $("reports").innerHTML = table(
    ["报告", "更新时间"],
    data.reports.slice(0, 12).map((r) => `<tr>
      <td>${escapeHtml(r.title)}</td>
      <td>${new Date(r.updatedAt).toLocaleString()}</td>
    </tr>`)
  );
}

$("refresh").addEventListener("click", load);
load().catch((error) => {
  $("meta").textContent = `加载失败：${error.message}`;
});
setInterval(load, 600_000);
