const $ = (id) => document.getElementById(id);

function link(account) {
  if (!account) return "";
  return `<a href="https://x.com/${account}" target="_blank" rel="noreferrer">@${account}</a>`;
}

function tags(items) {
  return (items || []).map((item) => `<span class="tag">${item}</span>`).join("");
}

function table(headers, rows, empty = "鏆傛棤鏁版嵁") {
  if (!rows.length) return `<div class="table-wrap"><p class="empty">${empty}</p></div>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

async function load() {
  const res = await fetch(`./data.json?t=${Date.now()}`);
  const data = await res.json();

  $("meta").textContent = `鏈€鍚庣敓鎴愶細${new Date(data.generatedAt).toLocaleString()}锛岄〉闈㈡瘡 60 绉掕嚜鍔ㄥ埛鏂癭;
  $("totals").innerHTML = [
    ["绛涢€夊悗椤圭洰", data.totals.projects],
    ["TG 璁板綍", data.totals.telegramRows],
    ["X 璁板綍", data.totals.xRows],
    ["鍙屾潵婧愰」鐩?, data.totals.crossSource],
  ].map(([label, value]) => `<div class="card"><span>${label}</span><strong>${value}</strong></div>`).join("");

  $("cross").innerHTML = table(
    ["椤圭洰", "璐﹀彿", "鏉ユ簮", "Alpha", "寮哄害"],
    data.crossSource.slice(0, 20).map((p) => `<tr>
      <td>${p.project}</td>
      <td>${link(p.account)}</td>
      <td>${tags(p.sources)}</td>
      <td>${tags((p.tgAlphas || []).slice(0, 8))}</td>
      <td>${tags((p.xAlphas || []).slice(0, 8))}</td>
      <td class="score">${p.score}</td>
    </tr>`)
  );

  $("tg").innerHTML = table(
    ["椤圭洰", "璐﹀彿", "绱娆℃暟", "鐘舵€?],
    data.tgPriority.slice(0, 20).map((p) => `<tr>
      <td>${p.project}</td>
      <td>${link(p.x_account)}</td>
      <td class="score">${p.total_mentions}</td>
      <td>${p.status}</td>
    </tr>`)
  );

  $("xmulti").innerHTML = table(
    ["椤圭洰", "璐﹀彿", "Alpha 鏁?, "Alpha"],
    data.xMultiAlpha.slice(0, 30).map((p) => `<tr>
      <td>${p.project}</td>
      <td>${link(p.account)}</td>
      <td class="score">${p.alphas.length}</td>
      <td>${tags(p.alphas.slice(0, 10))}</td>
    </tr>`)
  );

  $("reports").innerHTML = table(
    ["鎶ュ憡", "鏇存柊鏃堕棿"],
    data.reports.slice(0, 12).map((r) => `<tr>
      <td>${r.title}</td>
      <td>${new Date(r.updatedAt).toLocaleString()}</td>
    </tr>`)
  );
}

$("refresh").addEventListener("click", load);
load().catch((error) => {
  $("meta").textContent = `鍔犺浇澶辫触锛?{error.message}`;
});
setInterval(load, 60_000);

