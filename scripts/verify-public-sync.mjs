import { readFile } from "node:fs/promises";

const local = JSON.parse(await readFile("data.json", "utf8"));
const expected = JSON.stringify(local);
const deadline = Date.now() + 150_000;
let matched = false;
do {
  try {
    const response = await fetch(`https://llzzqq111.github.io/alpha-monitor/data.json?verify=${Date.now()}`, {
      headers: { "cache-control": "no-cache", "user-agent": "AlphaMonitor-public-check" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok && JSON.stringify(await response.json()) === expected) {
      matched = true;
      break;
    }
  } catch {
    // A Pages rollout can briefly return the previous data or a network error.
  }
  if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10_000));
} while (Date.now() < deadline);
if (!matched) throw new Error("Public website has not confirmed the exact local data; update remains unverified");
console.log(`Public website verified: ${local.totals.projects} projects, ${local.totals.telegramRows} TG records, checked ${local.collection?.lastCheckedAt || "unknown"}`);
