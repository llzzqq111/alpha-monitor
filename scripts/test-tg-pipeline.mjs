import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseCsv } from "./csv.mjs";
import { extractMessages, parseFollow } from "./update-telegram.mjs";

const bio = 'An onchain swap protocol, with "routed" liquidity.\nBuilt on Solana.';
const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const toCsv = (rows) => {
  const keys = ["message_id", "datetime_utc", "alpha", "project", "x_account", "description"];
  return [keys.join(","), ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(","))].join("\r\n") + "\r\n";
};

const html = `<div class="tgme_widget_message js-widget_message" data-post="dodtwitterbot/90001">
  <div class="tgme_widget_message_user">Channel</div>
  <div class="tgme_widget_message_text">[Alpha] AlphaA 关注了 FixtureProtocol<br>用户简介：An onchain swap protocol, with &quot;routed&quot; liquidity.</div>
  <a href="https://x.com/fixtureprotocol">Profile</a><time datetime="2026-10-27T16:01:00Z"></time>
</div>`;
const messages = extractMessages(html);
assert.equal(messages.length, 1);
const follow = parseFollow(messages[0]);
assert.equal(follow.project, "FixtureProtocol");
assert.equal(follow.alpha, "AlphaA");
assert.equal(follow.x_account, "fixtureprotocol");
assert.match(follow.description, /swap protocol, with "routed" liquidity/);
assert.equal(parseFollow({ ...messages[0], datetime: "" }), null);
const multiline = parseFollow({ ...messages[0], text: '[Alpha] AlphaA 关注了 FixtureProtocol\n用户简介:Trade. Launch. Set your rules.\nThe v4 DEX + launchpad.\n你关注的3个用户也关注了ta\nhttps://x.com/fixtureprotocol' });
assert.equal(multiline.description, 'Trade. Launch. Set your rules.\nThe v4 DEX + launchpad.');
const emptyBio = parseFollow({ ...messages[0], text: '[Alpha] AlphaA 关注了 FixtureProtocol\n用户简介:\n你关注的3个用户也关注了ta\nhttps://x.com/fixtureprotocol' });
assert.equal(emptyBio, null);
assert.equal(parseFollow({ ...messages[0], links: ['https://x.com/AgentM_Tech'], text: '[Alpha] AlphaA 关注了 Margaret Rosenfeld\n用户简介:Chief Strategy & Legal Officer of BNBStandard\n你关注的2个用户也关注了ta' }), null);

const first = { ...follow, description: bio };
assert.equal(parseCsv(toCsv([first]))[0].description, bio);
const tempRoot = await fs.realpath(os.tmpdir());
const fixture = await fs.mkdtemp(path.join(tempRoot, "alpha-monitor-test-"));
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  await fs.mkdir(path.join(fixture, "snapshots"));
  await fs.mkdir(path.join(fixture, "site"));
  await fs.mkdir(path.join(fixture, "reports"));
  await fs.writeFile(path.join(fixture, "public-data-start.txt"), "2026-10-28\n");
  for (const file of ["index.html", "app.js", "styles.css"]) {
    await fs.copyFile(path.join(workspace, "site", file), path.join(fixture, "site", file));
  }
  const second = { ...first, message_id: "dodtwitterbot/90002", datetime_utc: "2026-10-28T01:00:00Z", alpha: "AlphaB" };
  const old = { ...first, message_id: "dodtwitterbot/89999", datetime_utc: "2026-10-27T15:59:00Z", alpha: "OldAlpha" };
  await fs.writeFile(path.join(fixture, "snapshots", "telegram-fixture.csv"), toCsv([old, first, second]));
  await fs.writeFile(path.join(fixture, "snapshots", "telegram-duplicate.csv"), toCsv([first]));
  await fs.writeFile(path.join(fixture, "snapshots", "2026-10-28-x-partial-fixture.csv"), "date,followed_account,alpha_account\n2026-10-28,xonlyprotocol,XAlpha\n");
  const build = spawnSync(process.execPath, [path.join(workspace, "scripts", "build-site.mjs")], { cwd: fixture, encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const data = JSON.parse(await fs.readFile(path.join(fixture, "data.json"), "utf8"));
  assert.equal(data.totals.telegramRows, 2);
  assert.equal(data.totals.xRows, 0);
  assert.equal(data.projects.length, 1);
  assert.equal(data.projects[0].mentions, 2);
  assert.equal(data.projects[0].description, bio);
  assert.deepEqual(data.projects[0].sources, ["TG"]);
  assert.equal(data.tgPriority[0].total_mentions, 2);
  assert.deepEqual(data.tgPriority[0].alphas, ["AlphaA", "AlphaB"]);
  assert.equal(data.tgPriority[0].description, bio);
  assert.equal(data.daily.find((group) => group.date === "2026-10-28").totalRows, 2);
  const browserInput = path.join(fixture, "browser-input.json");
  const browserMessage = { id: "90003", time: "2026-10-28T03:00:00Z", text: '[Alpha] AlphaC 关注了 FixtureProtocol\n用户简介:An onchain swap protocol.\nBuilt on Solana.\n你关注的9个用户也关注了ta\nhttps://x.com/fixtureprotocol', links: ["https://x.com/fixtureprotocol"] };
  await fs.writeFile(browserInput, JSON.stringify({ messages: [browserMessage, browserMessage, { ...browserMessage, id: "90004", time: "" }] }));
  for (let i = 0; i < 2; i += 1) {
    const imported = spawnSync(process.execPath, [path.join(workspace, "scripts", "import-telegram-browser-json.mjs"), browserInput, "--local-only"], { cwd: fixture, encoding: "utf8" });
    assert.equal(imported.status, 0, imported.stderr);
    assert.match(imported.stdout, new RegExp(`new ${i === 0 ? 1 : 0}`));
  }
  const importedData = JSON.parse(await fs.readFile(path.join(fixture, "data.json"), "utf8"));
  assert.equal(importedData.totals.telegramRows, 3);
  assert.equal(importedData.projects[0].mentions, 3);
  const counts = parseCsv(await fs.readFile(path.join(fixture, "telegram_project_counts.csv"), "utf8"));
  assert.equal(Number(counts[0].total_mentions), 4);
  assert.match(counts[0].alpha_names, /AlphaC/);
  console.log("TG pipeline passed: message parsing, bio CSV, Shanghai date cutoff, duplicate suppression, Alpha list, TG-only counts.");
} finally {
  assert(path.resolve(fixture).startsWith(path.join(tempRoot, "alpha-monitor-test-")));
  await fs.rm(fixture, { recursive: true, force: true });
}
