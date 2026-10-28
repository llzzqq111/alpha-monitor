import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const elements = new Map();
const document = { getElementById(id) {
  if (!elements.has(id)) elements.set(id, { innerHTML: "", textContent: "", value: "", addEventListener() {} });
  return elements.get(id);
} };
const context = vm.createContext({ document, console, Date, setInterval() {}, fetch: async () => ({ ok: true, json: async () => ({ projects: [], daily: [], totals: {} }) }) });
const code = await readFile(new URL("../site/app.js", import.meta.url), "utf8");
await vm.runInContext(code.replace(/^reload\(\);\r?\n/m, ""), context);
vm.runInContext(`state.day = '2026-10-28'; renderDaily({daily:[{date:'2026-10-28',projectCount:23,newCount:23,repeatCount:0,projects:[{project:'Repeated',account:'repeat',description:'DEX <test>',mentions:3,alphas:['A','B'],dayStatus:'new'}, ...Array.from({length:22},(_,i)=>({project:'Single'+i,account:'single'+i,mentions:1,alphas:['A'],dayStatus:'new'}))]}]});`, context);
const rendered = elements.get("daily").innerHTML;
assert.match(rendered, /本日多次出现 1/);
assert.match(rendered, /跨日再现 0/);
assert.match(rendered, /Single21/);
assert.match(rendered, /DEX &lt;test&gt;/);
assert.match(rendered, /class="score">3</);
const now = Date.parse("2026-10-29T01:06:14Z");
function checkStatus(checked, complete = true) {
  return vm.runInContext(`collectionStatus({collection:{lastCheckedAt:${JSON.stringify(checked)},coverageComplete:${complete}}},${now})`, context);
}
assert.equal(checkStatus("2026-10-29T00:06:14Z")[1], "status-ok");
assert.equal(checkStatus("2026-10-28T18:06:14Z")[1], "status-delayed");
assert.equal(checkStatus("2026-10-28T16:06:14Z")[1], "status-error");
assert.equal(checkStatus("2026-10-29T01:06:14Z", false)[1], "status-error");
assert.equal(checkStatus("2026-10-29T02:06:14Z")[1], "status-error");
assert.equal(checkStatus(null)[1], "status-pending");
assert.equal(checkStatus("invalid")[1], "status-pending");
vm.runInContext(`renderFreshness({collection:{lastCheckedAt:'2026-10-28T17:06:14Z',lastMessageAt:'2026-10-28T17:02:50Z',coverageComplete:true},generatedAt:'2026-10-28T17:06:15Z'});`, context);
const times = elements.get("update-times").innerHTML;
assert.match(times, /最近成功检测 TG/);
assert.match(times, /2026\/10\/29 01:06:14/);
assert.match(times, /2026\/10\/29 01:02:50/);
assert.match(times, /2026\/10\/29 01:06:15/);
assert.match(times, /实际消息时间，不是页面刷新时间/);
context.fetch = async () => ({ ok: false, status: 503 });
vm.runInContext('state.data = {marker:"previous data"};', context);
await vm.runInContext("reload()", context);
assert.equal(vm.runInContext("state.data.marker", context), "previous data");
assert.match(elements.get("collection-status").textContent, /网站数据读取失败/);
assert.match(elements.get("meta").textContent, /503/);
assert.equal(elements.get("update-times").innerHTML, times);
vm.runInContext("renderFreshness({collection:{lastCheckedAt:new Date().toISOString(),coverageComplete:true}});", context);
assert.match(elements.get("collection-status").textContent, /网站数据读取失败/);
console.log("TG UI passed: daily repeats, true counts, all rows, escaped bio, Shanghai timestamps, delayed checks and failed refresh without fake times.");
