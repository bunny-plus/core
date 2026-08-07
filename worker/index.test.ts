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
});
