import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { AuthSessions, discordLoginLifetimeMs } from "../server/auth-sessions";
import { discordCheckInterval } from "./discord";
import { handleRequest } from "./index";
import { authenticateRoomMember } from "./authentication";
import type { Env } from "./env";
import { readCookie } from "./session";
const user = { id: "123456789012345678", avatar: null, global_name: "Bunny", username: "bunny" };
const viewer = { id: user.id, admin: false, avatar: null, name: "Bunny", permissions: [] };
const member = { user, roles: ["staff"], pending: false };
function setup(context: TestContext) {
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  const env: Env = {
    AUTH_SESSIONS: store,
    ADMIN_DISCORD_IDS: "",
    APP_URL: "https://bunny.plus",
    API_URL: "https://api.bunny.plus",
    DISCORD_BOT_TOKEN: "private-backend-discord-token",
    DISCORD_CLIENT_ID: "client",
    DISCORD_CLIENT_SECRET: "private-client-secret",
    DISCORD_GUILD_ID: "guild",
    DISCORD_ROLE_PERMISSIONS: JSON.stringify({ staff: ["admin"] }),
    SESSION_SECRET: "private-session-secret-with-32-bytes",
    STREAM_URL: "https://stream.test/manifest/video.m3u8",
    TORBOX_API_KEY: "private-torbox-token",
  };
  return { store, env };
}
function redeem(token: string, headers: HeadersInit = {}) {
  return new Request("https://api.bunny.plus/api/login/discord", {
    method: "POST",
    headers: { Origin: "https://bunny.plus", "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ token }),
  });
}
function sessionRequest(token: string, path = "/api/session") {
  return new Request(`https://api.bunny.plus${path}`, {
    headers: { Cookie: `bp_session=${token}` },
  });
}
function cookieToken(response: Response) {
  const cookie = response.headers.get("Set-Cookie");
  assert.ok(cookie);
  const token = readCookie(
    new Request("https://api.bunny.plus", { headers: { Cookie: cookie } }),
    "bp_session",
  );
  assert.ok(token);
  return token;
}
test("Discord links create normal opaque sessions with fresh roles and revoke the previous sign-in", async (context) => {
  const { store, env } = setup(context);
  const previous = await store.create(viewer, null);
  const login = await store.issueLoginLink(user.id);
  let checks = 0;
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      checks++;
      assert.equal(String(input), `https://discord.com/api/v10/guilds/guild/members/${user.id}`);
      assert.equal(new Headers(init?.headers).get("Authorization"), `Bot ${env.DISCORD_BOT_TOKEN}`);
      return Response.json(member);
    },
  );
  const response = await handleRequest(redeem(login, { Cookie: `bp_session=${previous}` }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.match(
    response.headers.get("Set-Cookie")!,
    /; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/,
  );
  assert.doesNotMatch(response.headers.get("Set-Cookie")!, /private-|Domain=/);
  const token = cookieToken(response);
  assert.notEqual(token, login);
  assert.equal((await store.read(token))?.credentials, null);
  assert.equal((await store.read(token))?.viewer.admin, true);
  assert.deepEqual((await store.read(token))?.viewer.permissions, [
    "admin",
    "stream.manage",
    "chloe.chat",
  ]);
  assert.equal(await store.read(previous), null);
  assert.equal((await handleRequest(redeem(login), env)).status, 410);
  assert.equal(checks, 1);
  assert.equal(
    (await authenticateRoomMember(sessionRequest(token, "/api/room"), env))?.member.id,
    user.id,
  );
  assert.doesNotMatch(await (await handleRequest(sessionRequest(token), env)).text(), /private-/);
});
test("foreign origins, form posts, and link previews cannot consume a Discord login", async (context) => {
  const { store, env } = setup(context);
  const login = await store.issueLoginLink(user.id);
  context.mock.method(globalThis, "fetch", async () => {
    throw new Error("Should not contact Discord");
  });
  assert.equal(
    (await handleRequest(redeem(login, { Origin: "https://foreign.test" }), env)).status,
    403,
  );
  assert.equal(
    (await handleRequest(redeem(login, { "Content-Type": "text/plain" }), env)).status,
    415,
  );
  for (const method of ["GET", "HEAD"]) {
    assert.equal(
      (
        await handleRequest(
          new Request(`https://api.bunny.plus/api/login/discord?token=${login}`, { method }),
          env,
        )
      ).status,
      404,
    );
  }
  assert.equal(await store.loginUser(login), user.id);
});
test("simultaneous redemption of the same link creates exactly one session", async (context) => {
  const { store, env } = setup(context);
  const login = await store.issueLoginLink(user.id);
  context.mock.method(globalThis, "fetch", async () => Response.json(member));
  const responses = await Promise.all(
    Array.from({ length: 3 }, () => handleRequest(redeem(login), env)),
  );
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 410, 410]);
  assert.equal(responses.filter((response) => response.headers.has("Set-Cookie")).length, 1);
});
test("login links expire at ten minutes and issuing another replaces the previous one", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1800000000000 });
  const { store, env } = setup(context);
  const replaced = await store.issueLoginLink(user.id);
  const current = await store.issueLoginLink(user.id);
  assert.equal((await handleRequest(redeem(replaced), env)).status, 410);
  context.mock.timers.tick(discordLoginLifetimeMs - 1);
  assert.equal(await store.loginUser(current), user.id);
  context.mock.timers.tick(1);
  assert.equal((await handleRequest(redeem(current), env)).status, 410);
  assert.equal((await handleRequest(redeem("malformed"), env)).status, 400);
});
test("departed members and pending membership screening cannot redeem a link", async (context) => {
  const { store, env } = setup(context);
  let pending = false;
  context.mock.method(globalThis, "fetch", async () =>
    pending
      ? Response.json({ ...member, pending: true })
      : Response.json({ code: 10007, message: "Unknown Member" }, { status: 404 }),
  );
  for (const screened of [false, true]) {
    pending = screened;
    const login = await store.issueLoginLink(user.id);
    const response = await handleRequest(redeem(login), env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(await store.loginUser(login), null);
  }
});
test("Discord outages and mismatched identities leave the link available for retry", async (context) => {
  const { store, env } = setup(context);
  const login = await store.issueLoginLink(user.id);
  let result = Response.json({ message: "Unavailable" }, { status: 503 });
  context.mock.method(globalThis, "fetch", async () => result.clone());
  assert.equal((await handleRequest(redeem(login), env)).status, 503);
  assert.equal(await store.loginUser(login), user.id);
  result = Response.json({ ...member, user: { ...user, id: "someone-else" } });
  assert.equal((await handleRequest(redeem(login), env)).status, 503);
  assert.equal(await store.loginUser(login), user.id);
  result = Response.json(member);
  assert.equal((await handleRequest(redeem(login), env)).status, 200);
});
test("bot sessions renew without OAuth and recheck roles for the API and chat", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1800000000000 });
  const { store, env } = setup(context);
  const token = await store.create(
    { ...viewer, admin: true, permissions: ["admin", "stream.manage"] },
    null,
  );
  context.mock.timers.tick(29 * 24 * 60 * 60 * 1000);
  let checks = 0;
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      checks++;
      assert.ok(String(input).includes(`/members/${user.id}`));
      assert.equal(new Headers(init?.headers).get("Authorization"), `Bot ${env.DISCORD_BOT_TOKEN}`);
      return Response.json({ ...member, roles: [] });
    },
  );
  const responses = await Promise.all(
    Array.from({ length: 3 }, () => handleRequest(sessionRequest(token), env)),
  );
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(checks, 1);
  assert.equal((await store.read(token))?.viewer.admin, false);
  assert.equal((await store.read(token))?.viewer.expires, Date.now() + 30 * 24 * 60 * 60 * 1000);
  assert.equal(
    (await handleRequest(sessionRequest(token, "/api/admin/jellyfin/items"), env)).status,
    403,
  );
  assert.equal(
    (await authenticateRoomMember(sessionRequest(token, "/api/room"), env))?.member.admin,
    false,
  );
});
test("bot access failures preserve sessions; a confirmed departure revokes them", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1800000000000 });
  const { store, env } = setup(context);
  const token = await store.create(viewer, null);
  context.mock.timers.tick(discordCheckInterval);
  let result = Response.json({ code: 10004, message: "Unknown Guild" }, { status: 404 });
  context.mock.method(globalThis, "fetch", async () => result.clone());
  assert.equal((await handleRequest(sessionRequest(token), env)).status, 503);
  assert.ok(await store.read(token));
  result = Response.json({ code: 50001, message: "Missing Access" }, { status: 403 });
  assert.equal((await handleRequest(sessionRequest(token), env)).status, 503);
  assert.ok(await store.read(token));
  result = Response.json({ code: 10007, message: "Unknown Member" }, { status: 404 });
  assert.equal((await handleRequest(sessionRequest(token), env)).status, 401);
  assert.equal(await store.read(token), null);
});
