import assert from "node:assert/strict";
import test from "node:test";
import { MessageFlags, type InteractionEditReplyOptions } from "discord.js";
import { AuthSessions } from "./auth-sessions";
import { handleDiscordLogin } from "./discord-bot";
import type { Env } from "../worker/env";
const userId = "123456789012345678";
const env: Env = {
  ADMIN_DISCORD_IDS: "",
  APP_URL: "https://bunny.plus",
  DISCORD_BOT_TOKEN: "private-backend-discord-token",
  DISCORD_CLIENT_ID: "client",
  DISCORD_CLIENT_SECRET: "private-client-secret",
  DISCORD_GUILD_ID: "guild",
  DISCORD_ROLE_PERMISSIONS: "{}",
  SESSION_SECRET: "private-session-secret-with-32-bytes",
  STREAM_URL: "https://stream.test/manifest/video.m3u8",
  TORBOX_API_KEY: "private-torbox-token",
};
test("/login acknowledges privately before checking Discord and sends a single-use link button", async (context) => {
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  let deferred = false;
  const replies: InteractionEditReplyOptions[] = [];
  context.mock.method(globalThis, "fetch", async () => {
    assert.equal(deferred, true);
    return Response.json({
      user: { id: userId, avatar: null, global_name: "Bunny", username: "bunny" },
      roles: [],
    });
  });
  const interaction = {
    guildId: "guild",
    user: { id: userId },
    async deferReply(options: { flags: MessageFlags.Ephemeral }) {
      assert.equal(options.flags, MessageFlags.Ephemeral);
      deferred = true;
    },
    async editReply(options: InteractionEditReplyOptions) {
      replies.push(options);
    },
  };
  await handleDiscordLogin(interaction, { ...env, AUTH_SESSIONS: store });
  assert.equal(replies.length, 1);
  assert.match(replies[0].content!, /10 minutes/);
  const serialized = JSON.stringify(replies[0]);
  assert.doesNotMatch(serialized, /private-backend|private-client/);
  const match = serialized.match(/https:\/\/bunny\.plus\/login#([A-Za-z0-9_-]{43})/);
  assert.ok(match);
  assert.equal(await store.loginUser(match[1]), userId);
  await handleDiscordLogin(interaction, { ...env, AUTH_SESSIONS: store });
  assert.equal(await store.loginUser(match[1]), null);
});
test("/login from another server or DM cannot issue a login link", async (context) => {
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  context.mock.method(globalThis, "fetch", async () => {
    throw new Error("Must not check Discord");
  });
  for (const guildId of [null, "another-guild"]) {
    let reply = "";
    await handleDiscordLogin(
      {
        guildId,
        user: { id: userId },
        async deferReply(options) {
          assert.equal(options.flags, MessageFlags.Ephemeral);
        },
        async editReply(options) {
          reply = JSON.stringify(options);
        },
      },
      { ...env, AUTH_SESSIONS: store },
    );
    assert.match(reply, /Use \/login in Bunny's Discord server/);
    assert.doesNotMatch(reply, /https:\/\/bunny\.plus\/login#/);
  }
});
test("failed private delivery revokes the link and never logs credentials or falls back to a public reply", async (context) => {
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  const errors: string[] = [];
  context.mock.method(console, "error", (...args: string[]) => errors.push(args.join(" ")));
  context.mock.method(globalThis, "fetch", async () =>
    Response.json({
      user: { id: userId, avatar: null, global_name: null, username: "bunny" },
      roles: [],
    }),
  );
  let loginToken = "";
  let edits = 0;
  await handleDiscordLogin(
    {
      guildId: "guild",
      user: { id: userId },
      async deferReply() {},
      async editReply(options) {
        edits++;
        if (edits === 1) {
          loginToken = JSON.stringify(options).match(/login#([A-Za-z0-9_-]{43})/)![1];
          throw new Error(`${env.DISCORD_BOT_TOKEN} ${loginToken} private-interaction-token`);
        }
        assert.deepEqual(options.components, []);
      },
    },
    { ...env, AUTH_SESSIONS: store },
  );
  assert.equal(await store.loginUser(loginToken), null);
  assert.equal(edits, 2);
  assert.doesNotMatch(errors.join(" "), /private-|[A-Za-z0-9_-]{43}/);
  await handleDiscordLogin(
    {
      guildId: "guild",
      user: { id: userId },
      async deferReply() {
        throw new Error("private-interaction-token");
      },
      async editReply() {
        assert.fail("Cannot reply after a failed private acknowledgement");
      },
    },
    { ...env, AUTH_SESSIONS: store },
  );
});
