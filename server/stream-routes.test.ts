import assert from "node:assert/strict";
import test from "node:test";
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
  STREAM_URL: "https://private-playback.test/input/manifest/video.m3u8",
  TORBOX_API_KEY: "test",
};
test("playback routes enforce login, origin and JSON, and permit ordinary members", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("Signing should not fetch the stream");
  });
  const cookie = `bp_session=${await createSession({ admin: false, avatar: null, id: "route-viewer", name: "Viewer", permissions: [] }, env.SESSION_SECRET)}`;
  const request = (headers: Record<string, string>) =>
    new Request("https://api.bunny.plus/api/stream-playback", {
      method: "POST",
      body: "{}",
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
  assert.deepEqual(await response.json(), { url: env.STREAM_URL, expiresAt: null });
  assert.equal(calls, 0);
});
