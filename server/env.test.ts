import assert from "node:assert/strict";
import test from "node:test";

import { loadEnvironment } from "./env";

const validEnvironment: NodeJS.ProcessEnv = {
  API_URL: "https://api.bunny.plus",
  APP_URL: "https://bunny.plus",
  DISCORD_CLIENT_ID: "client",
  DISCORD_CLIENT_SECRET: "discord-secret",
  DISCORD_GUILD_ID: "guild",
  NODE_ENV: "production",
  RELAY_CONTROLLER_SECRET: "controller-secret",
  RELAY_CONTROLLER_URL: "http://192.168.1.240:10000",
  SESSION_SECRET: "a-secure-session-key-with-32-bytes",
  STREAM_URL: "https://gon.bunny.plus/bunny-plus/index.m3u8",
  TORBOX_API_KEY: "torbox-secret",
};

test("production environment accepts valid configuration and fills safe defaults", () => {
  const env = loadEnvironment(validEnvironment);
  assert.equal(env.ADMIN_DISCORD_IDS, "");
  assert.equal(env.DISCORD_ROLE_PERMISSIONS, "{}");
  assert.equal(env.STREAM_DELAY_SECONDS, "6");
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
    STREAM_URL: "http://localhost:8888/stream.m3u8",
  });
  assert.equal(env.RELAY_CONTROLLER_URL, undefined);
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
