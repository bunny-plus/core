import assert from "node:assert/strict";
import test from "node:test";

import { createSession } from "./session";
import { handleRequest, type Env } from "./index";

const env: Env = {
  ADMIN_DISCORD_IDS: "",
  APP_URL: "https://bunny.plus",
  API_URL: "https://api.bunny.plus",
  DISCORD_CLIENT_ID: "client",
  DISCORD_CLIENT_SECRET: "discord-secret",
  DISCORD_GUILD_ID: "guild",
  DISCORD_ROLE_PERMISSIONS: "{}",
  NODE_ENV: "production",
  RELAY_CONTROLLER_SECRET: "controller-secret",
  RELAY_CONTROLLER_URL: "http://controller.test",
  SESSION_SECRET: "a-secure-session-key-with-32-bytes",
  STREAM_DELAY_SECONDS: "6",
  STREAM_URL: "https://gon.bunny.plus/bunny-plus/index.m3u8",
  TORBOX_API_KEY: "torbox-secret",
};

async function adminCookie() {
  const token = await createSession(
    { admin: true, avatar: null, id: "1", name: "Bunny", permissions: ["stream.manage"] },
    env.SESSION_SECRET,
  );
  return `bp_session=${token}`;
}

test("authenticated API responses are private and mutation origins are enforced", async () => {
  const cookie = await adminCookie();
  const session = await handleRequest(
    new Request("https://api.bunny.plus/api/session", { headers: { Cookie: cookie } }),
    env,
  );
  assert.equal(session.status, 200);
  assert.equal(session.headers.get("Cache-Control"), "private, no-store");

  const rejected = await handleRequest(
    new Request("https://api.bunny.plus/api/admin/movies/add", {
      body: JSON.stringify({ hash: "bad" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: "https://example.test",
      },
      method: "POST",
    }),
    env,
  );
  assert.equal(rejected.status, 403);
});

test("JSON mutations reject invalid content and malformed input before upstream calls", async () => {
  const cookie = await adminCookie();
  const unsupported = await handleRequest(
    new Request("https://api.bunny.plus/api/admin/movies/add", {
      body: "hash=bad",
      headers: { "Content-Type": "text/plain", Cookie: cookie, Origin: env.APP_URL },
      method: "POST",
    }),
    env,
  );
  assert.equal(unsupported.status, 415);

  const invalid = await handleRequest(
    new Request("https://api.bunny.plus/api/admin/movies/add", {
      body: JSON.stringify({ hash: "bad" }),
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: env.APP_URL },
      method: "POST",
    }),
    env,
  );
  assert.equal(invalid.status, 400);

  const unsupportedRestream = await handleRequest(
    new Request("https://api.bunny.plus/api/admin/restream/start", {
      body: JSON.stringify({ quality: "best", source: "https://example.com/live" }),
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: env.APP_URL },
      method: "POST",
    }),
    env,
  );
  assert.equal(unsupportedRestream.status, 400);
  assert.deepEqual(await unsupportedRestream.json(), {
    error: "Only YouTube and Twitch streams are supported",
  });
});

test("stream info combines relay metadata and HLS availability", async (context) => {
  const cookie = await adminCookie();
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url === env.RELAY_CONTROLLER_URL) {
      return Response.json({ running: true, title: "Movie night" });
    }
    if (url === env.STREAM_URL) {
      return new Response("#EXTM3U", { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const response = await handleRequest(
    new Request("https://api.bunny.plus/api/stream-info", { headers: { Cookie: cookie } }),
    env,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    online: true,
    running: true,
    title: "Movie night",
    upstreamStatus: 200,
  });
  assert.deepEqual(requests.sort(), [env.RELAY_CONTROLLER_URL, env.STREAM_URL].sort());

  const removed = await handleRequest(
    new Request("https://api.bunny.plus/api/stream-status", { headers: { Cookie: cookie } }),
    env,
  );
  assert.equal(removed.status, 404);
});

test("stream info coalesces concurrent upstream probes", async (context) => {
  const cookie = await adminCookie();
  const isolatedEnv = {
    ...env,
    RELAY_CONTROLLER_URL: "http://coalesced-controller.test",
    STREAM_URL: "https://coalesced-stream.test/index.m3u8",
  };
  let requests = 0;
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return String(input) === isolatedEnv.RELAY_CONTROLLER_URL
      ? Response.json({ running: true, title: "Together" })
      : new Response("#EXTM3U");
  });
  const request = () =>
    handleRequest(
      new Request("https://api.bunny.plus/api/stream-info", { headers: { Cookie: cookie } }),
      isolatedEnv,
    );

  const responses = await Promise.all([request(), request(), request()]);

  assert.deepEqual(
    await Promise.all(responses.map((response) => response.json())),
    Array(3).fill({ online: true, running: true, title: "Together", upstreamStatus: 200 }),
  );
  assert.equal(requests, 2);
});

test("Jellyfin routes require stream management permission and protect mutations", async () => {
  const token = await createSession(
    { admin: false, avatar: null, id: "viewer", name: "Viewer", permissions: [] },
    env.SESSION_SECRET,
  );
  const headers = {
    Cookie: `bp_session=${token}`,
    Origin: env.APP_URL,
    "Content-Type": "application/json",
  };
  for (const route of ["items", "options", "start"]) {
    const response = await handleRequest(
      new Request(`https://api.bunny.plus/api/admin/jellyfin/${route}`, {
        headers,
        method: route === "items" ? "GET" : "POST",
        body: route === "items" ? undefined : "{}",
      }),
      env,
    );
    assert.equal(response.status, 403);
  }
  const cookie = await adminCookie();
  const unsupported = await handleRequest(
    new Request("https://api.bunny.plus/api/admin/jellyfin/start", {
      method: "POST",
      headers: { Cookie: cookie, Origin: env.APP_URL, "Content-Type": "text/plain" },
      body: "{}",
    }),
    env,
  );
  assert.equal(unsupported.status, 415);
  const foreign = await handleRequest(
    new Request("https://api.bunny.plus/api/admin/jellyfin/start", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://other.test", "Content-Type": "application/json" },
      body: "{}",
    }),
    env,
  );
  assert.equal(foreign.status, 403);
});

test("Jellyfin starts through the shared controller and never returns credentials to the client", async (context) => {
  const itemId = "f".repeat(32);
  const jellyfinEnv = {
    ...env,
    JELLYFIN_URL: "https://jellyfin.test/jellyfin",
    JELLYFIN_API_KEY: "api-token-private-for-tests",
  };
  const cookie = await adminCookie();
  let controllerCalls = 0;
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).startsWith(jellyfinEnv.JELLYFIN_URL))
        return Response.json({
          Items: [
            {
              Id: itemId,
              Name: "Together",
              Type: "Movie",
              MediaSources: [
                {
                  Id: "version",
                  Protocol: "File",
                  MediaStreams: [
                    { Type: "Video", Index: 0, Height: 1080 },
                    { Type: "Subtitle", Index: 3, Codec: "ass", DisplayTitle: "English" },
                  ],
                },
              ],
            },
          ],
        });
      assert.equal(String(input), env.RELAY_CONTROLLER_URL);
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        `Bearer ${env.RELAY_CONTROLLER_SECRET}`,
      );
      const sent = JSON.parse(String(init?.body));
      assert.equal(sent.action, "jellyfin");
      assert.equal(sent.apiKey, jellyfinEnv.JELLYFIN_API_KEY);
      assert.equal(sent.audioIndex, null);
      assert.equal(sent.subtitleIndex, 3);
      assert.equal(sent.title, "Together");
      assert.ok(!sent.source.includes(jellyfinEnv.JELLYFIN_API_KEY));
      controllerCalls += 1;
      return Response.json({ running: true, title: "Together" });
    },
  );
  const response = await handleRequest(
    new Request("https://api.bunny.plus/api/admin/jellyfin/start", {
      method: "POST",
      headers: { Cookie: cookie, Origin: env.APP_URL, "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, mediaSourceId: "version", subtitleIndex: 3 }),
    }),
    jellyfinEnv,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    detail: "Jellyfin stream is starting",
    title: "Together",
  });
  assert.equal(controllerCalls, 1);
});
