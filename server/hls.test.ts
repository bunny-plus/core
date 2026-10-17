import assert from "node:assert/strict";
import test from "node:test";
import { playbackAuthorization } from "../src/hls";

test("HLS renews expiring authorization once for simultaneous requests and preserves LL-HLS parameters", async (context) => {
  let now = 100_000;
  context.mock.method(Date, "now", () => now);
  let calls = 0;
  const auth = playbackAuthorization(async () => ({
    url: `https://stream.test/token-${++calls}/manifest/video.m3u8?protocol=llhlsbeta`,
    expiresAt: now + 3_600_000,
  }));
  const first = await auth.get();
  assert.equal(calls, 1);
  now += 3_500_000;
  const source = first.url + "&_HLS_msn=120&_HLS_part=2";
  const urls = await Promise.all([auth.requestUrl(source), auth.requestUrl(source)]);
  assert.equal(calls, 2);
  assert.deepEqual(urls, [
    source.replace("token-1", "token-2"),
    source.replace("token-1", "token-2"),
  ]);
  assert.equal(
    await auth.requestUrl("https://media.test/segment.ts?token=separate"),
    "https://media.test/segment.ts?token=separate",
  );
  assert.equal(
    await auth.requestUrl("https://stream.test/token-1-other/segment.ts"),
    "https://stream.test/token-1-other/segment.ts",
  );
});

test("HLS never silently reuses expired credentials when renewal is denied", async (context) => {
  let now = 100_000;
  context.mock.method(Date, "now", () => now);
  let calls = 0;
  const auth = playbackAuthorization(async () => {
    if (calls++) throw new Error("Access denied");
    return { url: "https://stream.test/token/manifest/video.m3u8", expiresAt: now + 3_600_000 };
  });
  const first = await auth.get();
  now += 3_600_000;
  await assert.rejects(auth.requestUrl(first.url), /Access denied/);
  await assert.rejects(auth.requestUrl(first.url), /Access denied/);
  assert.equal(calls, 3);
});
