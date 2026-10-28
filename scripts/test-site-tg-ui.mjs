import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const elements = new Map();
const document = { getElementById(id) {
  if (!elements.has(id)) elements.set(id, { innerHTML: "", textContent: "", value: "", addEventListener() {} });
  return elements.get(id);
} };
const context = vm.createContext({ document, console, Date, setInterval() {}, fetch: async () => ({ json: async () => ({ projects: [], daily: [], totals: {} }) }) });
const code = await readFile(new URL("../site/app.js", import.meta.url), "utf8");
await vm.runInContext(code.replace(/load\(\);\s*$/, ""), context);
vm.runInContext(`state.day = '2026-10-28'; renderDaily({daily:[{date:'2026-10-28',projectCount:23,newCount:23,repeatCount:0,projects:[{project:'Repeated',account:'repeat',description:'DEX <test>',mentions:3,alphas:['A','B'],dayStatus:'new'}, ...Array.from({length:22},(_,i)=>({project:'Single'+i,account:'single'+i,mentions:1,alphas:['A'],dayStatus:'new'}))]}]});`, context);
const rendered = elements.get("daily").innerHTML;
assert.match(rendered, /本日多次出现 1/);
assert.match(rendered, /跨日再现 0/);
assert.match(rendered, /Single21/);
assert.match(rendered, /DEX &lt;test&gt;/);
assert.match(rendered, /class="score">3</);
console.log("TG UI passed: same-day repeats, true mention count, all daily rows, escaped bio.");
