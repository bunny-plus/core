import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadEnvironment } from "./env";

const validEnvironment: NodeJS.ProcessEnv = {
  API_URL: "https://api.bunny.plus",
  APP_URL: "https://bunny.plus",
  DISCORD_CLIENT_ID: "client",
  DISCORD_CLIENT_SECRET: "discord-secret",
  DISCORD_GUILD_ID: "guild",
  D1_DATABASE_URL: "https://bunny-database.example.workers.dev/query",
  D1_DATABASE_SECRET: "a".repeat(43),
  NODE_ENV: "production",
  RELAY_CONTROLLER_SECRET: "controller-secret",
  RELAY_CONTROLLER_URL: "http://192.168.1.240:10000",
  SESSION_SECRET: "a-secure-session-key-with-32-bytes",
  STREAM_URL: "https://stream.test/webRTC/play",
  TORBOX_API_KEY: "torbox-secret",
};

test("production environment accepts valid configuration and fills safe defaults", () => {
  const env = loadEnvironment(validEnvironment);
  assert.equal(env.ADMIN_DISCORD_IDS, "");
  assert.equal(env.DISCORD_ROLE_PERMISSIONS, "{}");
});

test("environment rejects missing or weak session secrets", () => {
  assert.throws(
    () => loadEnvironment({ ...validEnvironment, SESSION_SECRET: undefined }),
    /SESSION_SECRET is required/,
  );
  assert.throws(
    () => loadEnvironment({ ...validEnvironment, SESSION_SECRET: "too-short" }),
    /at least 32 bytes/,
  );
});

test("production environment requires fixed HTTPS public URLs", () => {
  assert.throws(
    () => loadEnvironment({ ...validEnvironment, API_URL: undefined }),
    /API_URL is required/,
  );
  assert.throws(
    () => loadEnvironment({ ...validEnvironment, APP_URL: "http://bunny.plus" }),
    /APP_URL must use HTTPS/,
  );
});

test("development environment can run without a relay controller", () => {
  const env = loadEnvironment({
    ...validEnvironment,
    API_URL: "http://localhost:8787",
    APP_URL: "http://localhost:5173",
    NODE_ENV: "development",
    RELAY_CONTROLLER_SECRET: undefined,
    RELAY_CONTROLLER_URL: undefined,
    STREAM_URL: "http://localhost:8888/webRTC/play",
  });
  assert.equal(env.RELAY_CONTROLLER_URL, undefined);
});

test("environment loads private Cloudflare playback credentials only as complete pairs", () => {
  const signing = {
    STREAM_URL: `https://customer-test.cloudflarestream.com/${"a".repeat(32)}/webRTC/play`,
    CLOUDFLARE_STREAM_SIGNING_KEY_ID: "test-key",
    CLOUDFLARE_STREAM_SIGNING_KEY_JWK: "validated-when-used",
  };
  const env = loadEnvironment({ ...validEnvironment, ...signing });
  assert.equal(env.CLOUDFLARE_STREAM_SIGNING_KEY_ID, signing.CLOUDFLARE_STREAM_SIGNING_KEY_ID);
  assert.throws(
    () =>
      loadEnvironment({
        ...validEnvironment,
        ...signing,
        CLOUDFLARE_STREAM_SIGNING_KEY_JWK: undefined,
      }),
    /both signing key ID and private JWK/,
  );
});

test("production environment rejects development authentication", () => {
  assert.throws(
    () => loadEnvironment({ ...validEnvironment, ENABLE_DEV_AUTH: "true" }),
    /cannot be enabled in production/,
  );
});

test("environment validates Discord role permission values", () => {
  assert.throws(
    () => loadEnvironment({ ...validEnvironment, DISCORD_ROLE_PERMISSIONS: '{"role":"admin"}' }),
    /permission arrays/,
  );
});

test("environment keeps Jellyfin optional and validates configured connection details", () => {
  assert.equal(loadEnvironment(validEnvironment).JELLYFIN_URL, undefined);
  const env = loadEnvironment({
    ...validEnvironment,
    JELLYFIN_URL: "https://jellyfin.test/jellyfin",
    JELLYFIN_API_KEY: "a".repeat(32),
  });
  assert.equal(env.JELLYFIN_API_KEY, "a".repeat(32));
  assert.throws(
    () => loadEnvironment({ ...validEnvironment, JELLYFIN_API_KEY: "a".repeat(32) }),
    /JELLYFIN_URL is required/,
  );
  assert.throws(
    () =>
      loadEnvironment({ ...validEnvironment, JELLYFIN_URL: "https://jellyfin.test/web/#/home" }),
    /HTTPS server URL/,
  );
  assert.throws(
    () =>
      loadEnvironment({
        ...validEnvironment,
        JELLYFIN_URL: "https://jellyfin.test",
        JELLYFIN_API_KEY: "a".repeat(32) + "\r\nInjected: yes",
      }),
    /valid API token/,
  );
});
test("Discord bot credentials are optional and can be loaded from a private token file", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-bot-token-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "discord-token");
  const token = "private-discord-bot-token";
  await writeFile(file, `Bot ${token}\n`, { mode: 0o600 });
  assert.equal(loadEnvironment(validEnvironment).DISCORD_BOT_TOKEN, undefined);
  assert.equal(
    loadEnvironment({ ...validEnvironment, DISCORD_BOT_TOKEN_FILE: file }).DISCORD_BOT_TOKEN,
    token,
  );
  assert.equal(
    loadEnvironment({ ...validEnvironment, DISCORD_BOT_TOKEN: token }).DISCORD_BOT_TOKEN,
    token,
  );
  assert.throws(
    () =>
      loadEnvironment({ ...validEnvironment, DISCORD_BOT_TOKEN_FILE: join(directory, "missing") }),
    /could not be read/,
  );
  assert.throws(
    () => loadEnvironment({ ...validEnvironment, DISCORD_BOT_TOKEN: token + "\r\nInjected: yes" }),
    /valid bot token/,
  );
});

test("D1 storage requires a complete private HTTPS endpoint and secret", () => {
  const configured = validEnvironment;
  const local = {
    ...validEnvironment,
    D1_DATABASE_URL: undefined,
    D1_DATABASE_SECRET: undefined,
  };
  assert.throws(() => loadEnvironment(local), /required in production/);
  assert.equal(loadEnvironment({ ...local, NODE_ENV: "development" }).D1_DATABASE_URL, undefined);
  assert.equal(loadEnvironment(configured).D1_DATABASE_URL, configured.D1_DATABASE_URL);
  for (const field of ["D1_DATABASE_URL", "D1_DATABASE_SECRET"])
    assert.throws(
      () => loadEnvironment({ ...configured, [field]: undefined }),
      /configured together/,
    );
  assert.throws(
    () => loadEnvironment({ ...configured, D1_DATABASE_URL: "http://database.test/query" }),
    /must use HTTPS/,
  );
  for (const url of [
    "https://database.test/",
    "https://database.test/query?secret=private",
    "https://user:password@database.test/query",
    "https://database.test/query#private",
  ])
    assert.throws(
      () => loadEnvironment({ ...configured, D1_DATABASE_URL: url }),
      /private \/query endpoint/,
    );
  assert.throws(
    () => loadEnvironment({ ...configured, D1_DATABASE_SECRET: "too-short" }),
    /32 random bytes/,
  );
});
