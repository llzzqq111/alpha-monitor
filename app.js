const $ = (id) => document.getElementById(id);

function link(account) {
  if (!account) return "";
  return `<a href="https://x.com/${account}" target="_blank" rel="noreferrer">@${account}</a>`;
}

function tags(items) {
  return (items || []).map((item) => `<span class="tag">${item}</span>`).join("");
}

function table(headers, rows, empty = "暂无数据") {
  if (!rows.length) return `<div class="table-wrap"><p class="empty">${empty}</p></div>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

async function load() {
  const res = await fetch(`./data.json?t=${Date.now()}`);
  const data = await res.json();

  $("meta").textContent = `最后生成：${new Date(data.generatedAt).toLocaleString()}，页面每 60 秒自动刷新`;
  $("totals").innerHTML = [
    ["项目总数", data.totals.projects],
    ["TG 记录", data.totals.telegramRows],
    ["X 记录", data.totals.xRows],
    ["双来源项目", data.totals.crossSource],
  ].map(([label, value]) => `<div class="card"><span>${label}</span><strong>${value}</strong></div>`).join("");

  $("cross").innerHTML = table(
    ["项目", "账号", "来源", "Alpha", "强度"],
    data.crossSource.slice(0, 20).map((p) => `<tr>
      <td>${p.project}</td>
      <td>${link(p.account)}</td>
      <td>${tags(p.sources)}</td>
      <td>${tags(p.alphas.slice(0, 8))}</td>
      <td class="score">${p.score}</td>
    </tr>`)
  );

  $("tg").innerHTML = table(
    ["项目", "账号", "累计次数", "状态"],
    data.tgPriority.slice(0, 20).map((p) => `<tr>
      <td>${p.project}</td>
      <td>${link(p.x_account)}</td>
      <td class="score">${p.total_mentions}</td>
      <td>${p.status}</td>
    </tr>`)
  );

  $("xmulti").innerHTML = table(
    ["项目", "账号", "Alpha 数", "Alpha"],
    data.xMultiAlpha.slice(0, 30).map((p) => `<tr>
      <td>${p.project}</td>
      <td>${link(p.account)}</td>
      <td class="score">${p.alphas.length}</td>
      <td>${tags(p.alphas.slice(0, 10))}</td>
    </tr>`)
  );

  $("reports").innerHTML = table(
    ["报告", "更新时间"],
    data.reports.slice(0, 12).map((r) => `<tr>
      <td>${r.title}</td>
      <td>${new Date(r.updatedAt).toLocaleString()}</td>
    </tr>`)
  );
}

$("refresh").addEventListener("click", load);
load().catch((error) => {
  $("meta").textContent = `加载失败：${error.message}`;
});
setInterval(load, 60_000);
