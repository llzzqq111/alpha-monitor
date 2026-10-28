import assert from "node:assert/strict";
import { collectSince, parseFollow } from "./update-telegram.mjs";

const page = (ids) => ids.map((id) => `<div data-post="dodtwitterbot/${id}"><div class="tgme_widget_message_text">[Alpha] AlphaA 关注了 FixtureProtocol<br>用户简介:An onchain protocol.</div><a href="https://x.com/fixtureprotocol">Project</a><time datetime="2026-10-29T00:00:00Z"></time></div>`).join("\n");
const urls = [];
const result = await collectSince(101, async (url) => {
  urls.push(url);
  return urls.length === 1 ? page([103, 104]) : page([101, 102, 103]);
});
assert.deepEqual(result.messages.map((message) => message.id), ["dodtwitterbot/102", "dodtwitterbot/103", "dodtwitterbot/104"]);
assert.equal(result.latest.id, "dodtwitterbot/104");
assert.equal(result.pages, 2);
assert.equal(new URL(urls[1]).searchParams.get("before"), "103");
assert.equal((await collectSince(104, async () => page([103, 104]))).messages.length, 0);
await assert.rejects(collectSince(101, async () => "<html>Sign in</html>"), /unreadable/);
await assert.rejects(collectSince(101, async () => page([103, 104])), /did not progress/);
await assert.rejects(collectSince(101, async () => page([103, 104]), 1), /exceeded/);
await assert.rejects(collectSince(105, async () => page([103, 104])), /older cached/);
await assert.rejects(collectSince(0, async () => page([103, 104])), /checkpoint/);
await assert.rejects(collectSince(101, async () => page([103]).replace(/datetime="[^"]+"/, "")), /verifiable date/);
const follow = parseFollow({ id: "dodtwitterbot/105", datetime: "2026-10-29T00:00:00Z", text: "[Alpha] AlphaA 关注了 FixtureProtocol\n用户简介:An onchain protocol.\n你关注的2个用户也关注了ta", links: ["https://x.com/somefounder", "https://x.com/fixtureprotocol"] });
assert.equal(follow.x_account, "fixtureprotocol");
console.log("Telegram history passed: backward pagination, overlaps, unchanged checkpoint, stale/invalid/partial history rejection, project profile selection.");
