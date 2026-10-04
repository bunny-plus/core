import assert from "node:assert/strict";
import test from "node:test";
import { createSession } from "./session";
import { handleRequest, type Env } from "./index";

const env: Env = {
  ADMIN_DISCORD_IDS: "",
  APP_URL: "https://bunny.plus",
  API_URL: "https://api.bunny.plus",
  DISCORD_CLIENT_ID: "client",
  DISCORD_CLIENT_SECRET: "secret",
  DISCORD_GUILD_ID: "guild",
  DISCORD_ROLE_PERMISSIONS: "{}",
  NODE_ENV: "production",
  SESSION_SECRET: "test-subtitles-session-key-with-32-bytes",
  STREAM_DELAY_SECONDS: "6",
  STREAM_URL: "https://stream.test/index.m3u8",
  TORBOX_API_KEY: "secret",
  RELAY_CONTROLLER_URL: "http://subtitle-controller.test",
  RELAY_CONTROLLER_SECRET: "controller-secret",
  JELLYFIN_URL: "https://jellyfin.test/jellyfin",
  JELLYFIN_API_KEY: "private-jellyfin-token",
};
const playback = {
  sessionId: "b".repeat(32),
  itemId: "a".repeat(32),
  mediaSourceId: "version-1",
  startedAt: 1_800_000_000_000,
  subtitleIndex: 3,
};
const source = {
  Id: playback.mediaSourceId,
  Protocol: "File",
  Path: "/private/video.mkv",
  MediaStreams: [
    { Type: "Video", Index: 0 },
    { Type: "Subtitle", Index: 3, Codec: "ass", DisplayTitle: "English", Language: "eng" },
    { Type: "Subtitle", Index: 4, Codec: "srt", DisplayTitle: "Spanish", Language: "spa" },
    { Type: "Subtitle", Index: 7, Codec: "hdmv_pgs_subtitle", DisplayTitle: "PGS" },
  ],
  MediaAttachments: [
    { Index: 9, FileName: "Title.ttf" },
    { Index: 10, FileName: "cover.jpg" },
  ],
};
const ass = "[Script Info]\nScriptType: v4.00+\n[Events]\n";

async function viewerCookie() {
  return `bp_session=${await createSession({ admin: false, avatar: null, id: "subtitle-viewer", name: "Viewer", permissions: [] }, env.SESSION_SECRET)}`;
}

test("room viewers can load only the admin-selected subtitles and fonts without Jellyfin credentials", async (context) => {
  const cookie = await viewerCookie();
  const calls: string[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url === env.RELAY_CONTROLLER_URL)
        return Response.json({ running: true, jellyfin: playback });
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        `MediaBrowser Token="${env.JELLYFIN_API_KEY}"`,
      );
      assert.equal(init?.redirect, "error");
      assert.ok(!url.includes(env.JELLYFIN_API_KEY!));
      if (url.includes("/Items?"))
        return Response.json({
          Items: [{ Id: playback.itemId, Name: "Movie", Type: "Movie", MediaSources: [source] }],
        });
      if (url.endsWith("Subtitles/3/Stream.ass?copyTimestamps=true")) return new Response(ass);
      if (url.endsWith("Attachments/9")) return new Response(new Uint8Array([0, 1, 0, 0, 0]));
      throw new Error("Unexpected upstream path");
    },
  );
  const request = (suffix = "") =>
    handleRequest(
      new Request(`https://api.bunny.plus/api/jellyfin/subtitles/${playback.sessionId}${suffix}`, {
        headers: { Cookie: cookie, Origin: env.APP_URL },
      }),
      env,
    );
  const listing = await request();
  assert.equal(listing.status, 200);
  const json = await listing.text();
  assert.ok(json.includes('"index":3'));
  assert.ok(!json.includes('"index":4'));
  assert.ok(!json.includes('"index":7'));
  assert.ok(json.includes('"fonts":[9]'));
  assert.ok(!json.includes("/private"));
  assert.ok(!json.includes(env.JELLYFIN_API_KEY!));
  const track = await request("/track/3");
  assert.equal(await track.text(), ass);
  assert.equal(track.headers.get("Cache-Control"), "private, no-store");
  const font = await request("/font/9");
  assert.equal(font.status, 200);
  assert.equal((await font.arrayBuffer()).byteLength, 5);
  const before = calls.filter((url) => url.includes("/Videos/")).length;
  assert.equal((await request("/track/4")).status, 404);
  assert.equal((await request("/track/7")).status, 404);
  assert.equal((await request("/track/99")).status, 404);
  assert.equal((await request("/font/10")).status, 404);
  assert.equal(calls.filter((url) => url.includes("/Videos/")).length, before);
});

test("no selected subtitles and legacy streams expose no viewer track choices or files", async (context) => {
  const cookie = await viewerCookie();
  for (const subtitleIndex of [null, undefined]) {
    const network = context.mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request) => {
        assert.equal(String(input), env.RELAY_CONTROLLER_URL);
        return Response.json({ running: true, jellyfin: { ...playback, subtitleIndex } });
      },
    );
    const request = (suffix = "") =>
      handleRequest(
        new Request(
          "https://api.bunny.plus/api/jellyfin/subtitles/" + playback.sessionId + suffix,
          { headers: { Cookie: cookie } },
        ),
        env,
      );
    assert.deepEqual(await (await request()).json(), { tracks: [], fonts: [] });
    assert.equal((await request("/track/3")).status, 404);
    assert.equal((await request("/font/9")).status, 404);
    assert.equal(network.mock.callCount(), 3);
  }
});

test("subtitles reject unauthenticated requests and stale stream identities before reading Jellyfin", async (context) => {
  const network = context.mock.method(globalThis, "fetch", async () =>
    Response.json({ running: true, jellyfin: playback }),
  );
  const url = `https://api.bunny.plus/api/jellyfin/subtitles/${"c".repeat(32)}/track/3`;
  assert.equal((await handleRequest(new Request(url), env)).status, 401);
  assert.equal(network.mock.callCount(), 0);
  const result = await handleRequest(
    new Request(url, { headers: { Cookie: await viewerCookie() } }),
    env,
  );
  assert.equal(result.status, 409);
  assert.equal(network.mock.callCount(), 1);
});

test("subtitles cannot finish loading after the controller switches episodes", async (context) => {
  let reads = 0;
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (String(input) === env.RELAY_CONTROLLER_URL)
      return Response.json({ running: ++reads === 1, jellyfin: playback });
    if (String(input).includes("/Items?"))
      return Response.json({
        Items: [{ Id: playback.itemId, Name: "Movie", Type: "Movie", MediaSources: [source] }],
      });
    return new Response(ass);
  });
  const result = await handleRequest(
    new Request(`https://api.bunny.plus/api/jellyfin/subtitles/${playback.sessionId}/track/3`, {
      headers: { Cookie: await viewerCookie() },
    }),
    env,
  );
  assert.equal(result.status, 409);
});
