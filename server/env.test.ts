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
  STREAM_URL: "https://stream.test/index.m3u8",
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

test("environment loads private Cloudflare playback credentials only as complete pairs", () => {
  const signing = {
    STREAM_URL: `https://customer-test.cloudflarestream.com/${"a".repeat(32)}/manifest/video.m3u8`,
    CLOUDFLARE_STREAM_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_STREAM_API_TOKEN: "cloudflare-api-token-secret",
  };
  const env = loadEnvironment({ ...validEnvironment, ...signing });
  assert.equal(env.CLOUDFLARE_STREAM_API_TOKEN, signing.CLOUDFLARE_STREAM_API_TOKEN);
  assert.throws(
    () =>
      loadEnvironment({ ...validEnvironment, ...signing, CLOUDFLARE_STREAM_ACCOUNT_ID: undefined }),
    /both account ID and API token/,
  );
});

test("recording cleanup requires a complete credential pair for a private live input", () => {
  const configured = {
    ...validEnvironment,
    STREAM_URL: `https://customer-test.cloudflarestream.com/${"a".repeat(32)}/manifest/video.m3u8`,
    CLOUDFLARE_STREAM_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_STREAM_API_TOKEN: "private-playback-api-token",
    STREAM_RECORDING_CLEANUP_ACCOUNT_ID: "a".repeat(32),
    STREAM_RECORDING_CLEANUP_API_TOKEN: "private-recording-cleanup-token",
  };
  assert.equal(
    loadEnvironment(configured).STREAM_RECORDING_CLEANUP_API_TOKEN,
    configured.STREAM_RECORDING_CLEANUP_API_TOKEN,
  );
  assert.throws(
    () => loadEnvironment({ ...configured, STREAM_RECORDING_CLEANUP_API_TOKEN: undefined }),
    /both account ID and API token/,
  );
  assert.throws(
    () => loadEnvironment({ ...configured, STREAM_RECORDING_CLEANUP_ACCOUNT_ID: "invalid" }),
    /credentials are invalid/,
  );
});

test("recording cleanup reuses the existing Stream token and account without separate credentials", () => {
  const configured = {
    ...validEnvironment,
    STREAM_URL: `https://customer-test.cloudflarestream.com/${"a".repeat(32)}/manifest/video.m3u8`,
    CLOUDFLARE_STREAM_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_STREAM_API_TOKEN: "existing-stream-read-and-edit-token",
  };
  const result = loadEnvironment(configured);
  assert.equal(result.STREAM_RECORDING_CLEANUP_ACCOUNT_ID, configured.CLOUDFLARE_STREAM_ACCOUNT_ID);
  assert.equal(result.STREAM_RECORDING_CLEANUP_API_TOKEN, configured.CLOUDFLARE_STREAM_API_TOKEN);
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
