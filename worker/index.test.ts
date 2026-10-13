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
  STREAM_URL: "https://stream.test/index.m3u8",
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
  const sessionBody = await session.json();
  assert.equal(sessionBody.streamConfigured, true);
  assert.equal(sessionBody.streamUrl, "/api/stream-playback");
  assert.ok(!JSON.stringify(sessionBody).includes(env.STREAM_URL));

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

test("stream runtime is available to members, caches Jellyfin metadata, and clears for other sources", async (context) => {
  const runtimeEnv = {
    ...env,
    RELAY_CONTROLLER_URL: "http://runtime-controller.test",
    JELLYFIN_URL: "https://runtime-jellyfin.test",
    JELLYFIN_API_KEY: "private-runtime-token",
  };
  const token = await createSession(
    { admin: false, avatar: null, id: "runtime-viewer", name: "Viewer", permissions: [] },
    env.SESSION_SECRET,
  );
  const headers = { Cookie: `bp_session=${token}` };
  const playback = {
    sessionId: "b".repeat(32),
    itemId: "a".repeat(32),
    mediaSourceId: "version-1",
    startedAt: null,
  };
  let jellyfinCalls = 0;
  let running = true;
  let jellyfin = true;
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url === runtimeEnv.RELAY_CONTROLLER_URL) {
      return Response.json({
        running,
        title: running ? "Movie night" : null,
        jellyfin: jellyfin && running ? playback : undefined,
      });
    }
    if (url.startsWith(runtimeEnv.JELLYFIN_URL)) {
      jellyfinCalls += 1;
      return Response.json({
        Items: [{ RunTimeTicks: 54_000_000_000, Path: "/private/movie.mkv" }],
      });
    }
    if (url === env.STREAM_URL) return new Response("#EXTM3U");
    throw new Error(`Unexpected request: ${url}`);
  });
  const info = () =>
    handleRequest(new Request(`${env.API_URL}/api/stream-info`, { headers }), runtimeEnv);
  const first = await info();
  assert.equal(first.status, 200);
  const result = await first.json();
  assert.equal(result.runtimeSeconds, 5400);
  assert.ok(!JSON.stringify(result).includes(runtimeEnv.JELLYFIN_API_KEY));
  assert.ok(!JSON.stringify(result).includes("/private"));
  assert.equal((await info()).status, 200);
  assert.equal(jellyfinCalls, 1);
  const later = Date.now() + 6_000;
  context.mock.method(Date, "now", () => later);
  assert.equal((await (await info()).json()).runtimeSeconds, 5400);
  assert.equal(jellyfinCalls, 1);

  const adminHeaders = {
    Cookie: await adminCookie(),
    Origin: env.APP_URL,
    "Content-Type": "application/json",
  };
  running = false;
  await handleRequest(
    new Request(`${env.API_URL}/api/admin/stream/stop`, { headers: adminHeaders, method: "POST" }),
    runtimeEnv,
  );
  assert.equal((await (await info()).json()).runtimeSeconds, undefined);
  assert.equal(jellyfinCalls, 1);

  jellyfin = false;
  running = true;
  await handleRequest(
    new Request(`${env.API_URL}/api/admin/restream/start`, {
      headers: adminHeaders,
      method: "POST",
      body: JSON.stringify({ source: "https://www.twitch.tv/bunnyplus", quality: "best" }),
    }),
    runtimeEnv,
  );
  assert.equal((await (await info()).json()).runtimeSeconds, undefined);
  assert.equal(jellyfinCalls, 1);
});

test("Jellyfin metadata failure leaves the stream playable without a runtime", async (context) => {
  const runtimeEnv = {
    ...env,
    RELAY_CONTROLLER_URL: "http://runtime-failure-controller.test",
    JELLYFIN_URL: "https://runtime-failure-jellyfin.test",
    JELLYFIN_API_KEY: "private-runtime-token",
  };
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url === runtimeEnv.RELAY_CONTROLLER_URL)
      return Response.json({
        running: true,
        title: "Movie night",
        jellyfin: {
          sessionId: "b".repeat(32),
          itemId: "a".repeat(32),
          mediaSourceId: "version-1",
          startedAt: null,
        },
      });
    if (url.startsWith(runtimeEnv.JELLYFIN_URL))
      return new Response("Unavailable", { status: 503 });
    return new Response("#EXTM3U");
  });
  const response = await handleRequest(
    new Request(`${env.API_URL}/api/stream-info`, { headers: { Cookie: await adminCookie() } }),
    runtimeEnv,
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.online, true);
  assert.equal(result.running, true);
  assert.equal(result.runtimeSeconds, undefined);
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

test("stream info distinguishes playback denial from an unavailable broadcast", async (context) => {
  const cookie = await adminCookie();
  for (const status of [204, 401, 403, 404]) {
    await context.test(`HLS responds with ${status}`, async (probe) => {
      const isolatedEnv = {
        ...env,
        RELAY_CONTROLLER_URL: `http://playback-status-${status}.test`,
        STREAM_URL: `https://playback-status-${status}.test/index.m3u8`,
      };
      probe.mock.method(
        globalThis,
        "fetch",
        async (input: string | URL | Request, init?: RequestInit) => {
          if (String(input) === isolatedEnv.RELAY_CONTROLLER_URL)
            return Response.json({ running: true, title: "Private screening" });
          assert.equal(String(input), isolatedEnv.STREAM_URL);
          const headers = new Headers(init?.headers);
          assert.equal(headers.get("Origin"), env.APP_URL);
          assert.equal(headers.get("Referer"), `${env.APP_URL}/`);
          return new Response(status === 204 ? null : "private upstream diagnostic", { status });
        },
      );
      const response = await handleRequest(
        new Request("https://api.bunny.plus/api/stream-info", { headers: { Cookie: cookie } }),
        isolatedEnv,
      );
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.online, false);
      assert.equal(body.running, true);
      assert.equal(body.title, "Private screening");
      assert.equal(body.upstreamStatus, status);
      assert.equal(body.playbackError, [401, 403].includes(status) ? "access-denied" : undefined);
      assert.ok(!JSON.stringify(body).includes("private upstream diagnostic"));
    });
  }
});

test("stream info reports signing failures without exposing keys or probing unsigned playback", async (context) => {
  const signingEnv = {
    ...env,
    RELAY_CONTROLLER_URL: "http://invalid-signing-controller.test",
    STREAM_URL: `https://customer-test.cloudflarestream.com/${"a".repeat(32)}/manifest/video.m3u8`,
    CLOUDFLARE_STREAM_SIGNING_KEY_ID: "invalid-signing-key",
    CLOUDFLARE_STREAM_SIGNING_KEY_JWK: "invalid-private-jwk-secret",
  };
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requests.push(String(input));
    assert.equal(String(input), signingEnv.RELAY_CONTROLLER_URL);
    return Response.json({ running: true, title: "Private screening" });
  });
  const cookie = await adminCookie();
  const response = await handleRequest(
    new Request("https://api.bunny.plus/api/stream-info", { headers: { Cookie: cookie } }),
    signingEnv,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    online: false,
    playbackError: "signing-failed",
    running: true,
    title: "Private screening",
    upstreamStatus: null,
  });
  assert.ok(!JSON.stringify(body).includes(signingEnv.CLOUDFLARE_STREAM_SIGNING_KEY_JWK));
  assert.deepEqual(requests, [signingEnv.RELAY_CONTROLLER_URL]);
});

test("private playback links require a session and availability probes use signed HLS", async (context) => {
  const inputId = "a".repeat(32);
  const signingEnv = {
    ...env,
    RELAY_CONTROLLER_URL: "http://signed-controller.test",
    STREAM_URL: `https://customer-test.cloudflarestream.com/${inputId}/manifest/video.m3u8?protocol=llhlsbeta`,
    CF_ACCOUNT_ID: "b".repeat(32),
    CF_TOKEN: "private-playback-api-token",
  };
  const signedUrl =
    "https://customer-test.cloudflarestream.com/header.claims.signature/manifest/video.m3u8?protocol=llhlsbeta";
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url === signingEnv.RELAY_CONTROLLER_URL)
      return Response.json({ running: true, title: "Private screening" });
    if (url === signedUrl) return new Response("#EXTM3U");
    if (
      url ===
      `https://api.cloudflare.com/client/v4/accounts/${signingEnv.CF_ACCOUNT_ID}/stream/${inputId}/token`
    )
      return Response.json({ success: true, result: { token: "header.claims.signature" } });
    throw new Error(`Unexpected request: ${url}`);
  });
  const unauthenticated = await handleRequest(
    new Request("https://api.bunny.plus/api/stream-playback"),
    signingEnv,
  );
  assert.equal(unauthenticated.status, 401);
  assert.equal(requests.length, 0);
  const viewer = await createSession(
    { admin: false, avatar: null, id: "signed-viewer", name: "Viewer", permissions: [] },
    env.SESSION_SECRET,
  );
  const headers = { Cookie: `bp_session=${viewer}` };
  const playback = await handleRequest(
    new Request("https://api.bunny.plus/api/stream-playback", { headers }),
    signingEnv,
  );
  assert.equal(playback.status, 200);
  assert.equal(playback.headers.get("Cache-Control"), "private, no-store");
  const body = await playback.json();
  assert.deepEqual(Object.keys(body).sort(), ["expiresAt", "url"]);
  assert.equal(body.url, signedUrl);
  assert.ok(body.expiresAt > Date.now());
  assert.ok(!JSON.stringify(body).includes(signingEnv.CF_TOKEN));
  const info = await handleRequest(
    new Request("https://api.bunny.plus/api/stream-info", { headers }),
    signingEnv,
  );
  assert.equal(info.status, 200);
  assert.deepEqual(await info.json(), {
    online: true,
    running: true,
    title: "Private screening",
    upstreamStatus: 200,
  });
  assert.ok(requests.includes(signedUrl));
  assert.ok(!requests.includes(signingEnv.STREAM_URL));
  assert.equal(requests.filter((url) => url.startsWith("https://api.cloudflare.com/")).length, 1);
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
