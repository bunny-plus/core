import assert from "node:assert/strict";
import test from "node:test";
import { startPlayback, stopPlayback } from "./webrtc";
import { handleRequest } from "../worker/index";
import { createSession } from "../worker/session";
import type { Env } from "../worker/env";

const env: Env = {
  ADMIN_DISCORD_IDS: "",
  APP_URL: "https://bunny.plus",
  DISCORD_CLIENT_ID: "client",
  DISCORD_CLIENT_SECRET: "secret",
  DISCORD_GUILD_ID: "guild",
  DISCORD_ROLE_PERMISSIONS: "{}",
  SESSION_SECRET: "private-test-session-secret-at-least-32-bytes",
  STREAM_URL: "https://private-playback.test/input/webRTC/play",
  TORBOX_API_KEY: "test",
};
const offer = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n";
const answer = "v=0\r\ns=private-live-stream\r\n";
const resource = "https://private-playback.test/input/webRTC/session/private-resource";

test("negotiation keeps upstream URLs private and closes only the viewer's own session", async (context) => {
  const requests: { url: string; init?: RequestInit }[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : new Response(answer, {
            status: 201,
            headers: { Location: resource, "Content-Type": "application/sdp" },
          });
    },
  );
  const playback = await startPlayback(env, "viewer", offer);
  assert.equal(playback.sdp, answer);
  assert.deepEqual(Object.keys(playback).sort(), ["sdp", "session"]);
  assert.ok(!JSON.stringify(playback).includes("private-playback.test"));
  assert.equal(requests[0].url, env.STREAM_URL);
  assert.equal(requests[0].init?.body, offer);
  assert.equal(requests[0].init?.redirect, "error");
  await assert.rejects(
    stopPlayback(env, "different-viewer", playback.session),
    /Invalid playback session/,
  );
  await assert.rejects(
    stopPlayback(env, "viewer", playback.session.slice(0, -4) + "AAAA"),
    /Invalid playback session/,
  );
  assert.equal(requests.length, 1);
  await stopPlayback(env, "viewer", playback.session);
  assert.equal(requests[1].url, resource);
  assert.equal(requests[1].init?.method, "DELETE");
});

test("closed sessions are idempotent and expired session tokens cannot be reused", async (context) => {
  let now = 1900000000000;
  context.mock.method(Date, "now", () => now);
  context.mock.method(
    globalThis,
    "fetch",
    async (_input: string | URL | Request, init?: RequestInit) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 404 })
        : new Response(answer, { headers: { Location: resource } }),
  );
  const playback = await startPlayback(env, "viewer", offer);
  await stopPlayback(env, "viewer", playback.session);
  now += 24 * 60 * 60 * 1000 + 1;
  await assert.rejects(stopPlayback(env, "viewer", playback.session), /Invalid playback session/);
});

test("playback failures distinguish access denial from warmup and never relay private upstream diagnostics", async (context) => {
  for (const status of [401, 403, 404, 409, 500, 503]) {
    context.mock.method(
      globalThis,
      "fetch",
      async () => new Response("private diagnostic", { status }),
    );
    await assert.rejects(startPlayback(env, "viewer", offer), {
      status: [401, 403].includes(status) ? 403 : 503,
      message: [401, 403].includes(status)
        ? "Playback access was denied"
        : "The stream is not ready. Reconnecting…",
    });
  }
});

test("invalid or oversized offers never reach the provider and session resources cannot redirect cleanup elsewhere", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(answer, { headers: { Location: "https://untrusted.test/secret" } });
  });
  for (const invalid of ["not SDP", "v=0" + "a".repeat(64000)])
    await assert.rejects(startPlayback(env, "viewer", invalid), /Invalid playback offer/);
  assert.equal(calls, 0);
  await assert.rejects(startPlayback(env, "viewer", offer), /invalid session/);
  assert.equal(calls, 1);
});

test("malformed or oversized answers release the allocated session", async (context) => {
  for (const body of ["invalid", "v=0" + "a".repeat(64000)]) {
    const methods: string[] = [];
    context.mock.method(
      globalThis,
      "fetch",
      async (_input: string | URL | Request, init?: RequestInit) => {
        methods.push(init?.method || "GET");
        return init?.method === "DELETE"
          ? new Response(null, { status: 204 })
          : new Response(body, { headers: { Location: resource } });
      },
    );
    await assert.rejects(startPlayback(env, "viewer", offer));
    assert.deepEqual(methods, ["POST", "DELETE"]);
  }
});

test("playback routes enforce login, origin and JSON, and permit ordinary members", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(answer, { headers: { Location: resource } });
  });
  const cookie = `bp_session=${await createSession({ admin: false, avatar: null, id: "route-viewer", name: "Viewer", permissions: [] }, env.SESSION_SECRET)}`;
  const request = (headers: Record<string, string>) =>
    new Request("https://api.bunny.plus/api/stream-playback", {
      method: "POST",
      body: JSON.stringify({ sdp: offer }),
      headers,
    });
  const base = { Origin: env.APP_URL, "Content-Type": "application/json" };
  assert.equal((await handleRequest(request(base), env)).status, 401);
  assert.equal(
    (await handleRequest(request({ ...base, Cookie: cookie, Origin: "https://other.test" }), env))
      .status,
    403,
  );
  assert.equal(
    (await handleRequest(request({ ...base, Cookie: cookie, "Content-Type": "text/plain" }), env))
      .status,
    415,
  );
  assert.equal(calls, 0);
  const response = await handleRequest(request({ ...base, Cookie: cookie }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await response.json()).sdp, answer);
  assert.equal(calls, 1);
});
