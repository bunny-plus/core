import assert from "node:assert/strict";
import test from "node:test";

import { AuthSessions } from "../server/auth-sessions";
import { handleRequest, authenticateRoomMember, type Env } from "./index";
import { discordCheckInterval } from "./discord";
import { createSession, readCookie, readSession } from "./session";

const day = 24 * 60 * 60 * 1_000;
const viewer = {
  admin: true,
  avatar: null,
  id: "bunny",
  name: "Bunny",
  permissions: ["admin", "stream.manage", "chloe.chat"],
};
const user = { id: "bunny", avatar: null, global_name: "Bunny", username: "bunny" };

function environment(store: AuthSessions): Env {
  return {
    AUTH_SESSIONS: store,
    ADMIN_DISCORD_IDS: "",
    APP_URL: "https://bunny.plus",
    API_URL: "https://api.bunny.plus",
    DISCORD_CLIENT_ID: "client",
    DISCORD_CLIENT_SECRET: "discord-secret",
    DISCORD_GUILD_ID: "guild",
    DISCORD_ROLE_PERMISSIONS: JSON.stringify({ staff: ["admin", "stream.manage"] }),
    NODE_ENV: "production",
    SESSION_SECRET: "a-secure-session-key-with-32-bytes",
    STREAM_DELAY_SECONDS: "6",
    STREAM_URL: "https://stream.test/index.m3u8",
    TORBOX_API_KEY: "torbox-secret",
  };
}

function request(
  token: string,
  path = "/api/session",
  method = "GET",
  origin = "https://bunny.plus",
) {
  return new Request(`https://api.bunny.plus${path}`, {
    headers: { Cookie: `bp_session=${token}`, Origin: origin },
    method,
  });
}

function credentials() {
  return {
    accessToken: "access-private",
    refreshToken: "refresh-private",
    expiresAt: Date.now() + 7 * day,
  };
}

test("Discord login creates a persistent opaque session without exposing OAuth credentials", async (context) => {
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  const env = environment(store);
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/oauth2/token")) {
        const form = new URLSearchParams(String(init?.body));
        assert.equal(form.get("grant_type"), "authorization_code");
        assert.equal(form.get("redirect_uri"), "https://api.bunny.plus/auth/callback");
        assert.equal(form.get("client_secret"), env.DISCORD_CLIENT_SECRET);
        return Response.json({
          access_token: "access-private",
          refresh_token: "refresh-private",
          expires_in: 604800,
        });
      }
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer access-private");
      return Response.json(url.endsWith("/users/@me") ? user : { roles: ["staff"] });
    },
  );
  const response = await handleRequest(
    new Request("https://api.bunny.plus/auth/callback?code=code&state=state", {
      headers: { Cookie: "bp_oauth=state" },
    }),
    env,
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), env.APP_URL);
  const cookie = response.headers.get("Set-Cookie");
  assert.ok(cookie);
  assert.match(cookie, /; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/);
  assert.doesNotMatch(cookie, /access-private|refresh-private|Domain=/);
  const token = readCookie(
    new Request(env.API_URL!, { headers: { Cookie: cookie } }),
    "bp_session",
  );
  assert.ok(token);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(store.read(token)?.viewer.admin, true);
  const session = await handleRequest(request(token), env);
  assert.equal(session.status, 200);
  assert.doesNotMatch(await session.text(), /access-private|refresh-private|expiresAt/);
});

test("returning after twenty-nine days refreshes Discord once and renews the sign-in", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  const env = environment(store);
  const token = store.create(viewer, credentials());
  context.mock.timers.tick(29 * day);
  let refreshes = 0;
  let membershipChecks = 0;
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/oauth2/token")) {
        refreshes += 1;
        const form = new URLSearchParams(String(init?.body));
        assert.equal(form.get("grant_type"), "refresh_token");
        assert.equal(form.get("refresh_token"), "refresh-private");
        return Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 604800,
        });
      }
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer new-access");
      if (!url.endsWith("/users/@me")) membershipChecks += 1;
      return Response.json(url.endsWith("/users/@me") ? user : { roles: ["staff"] });
    },
  );
  const responses = await Promise.all(
    Array.from({ length: 3 }, () => handleRequest(request(token), env)),
  );
  assert.ok(responses.every((response) => response.status === 200));
  assert.ok(
    responses.every((response) => response.headers.get("Set-Cookie")?.includes("Max-Age=2592000")),
  );
  assert.equal(refreshes, 1);
  assert.equal(membershipChecks, 1);
  assert.equal(store.read(token)?.viewer.expires, Date.now() + 30 * day);
  assert.equal(store.read(token)?.credentials.refreshToken, "new-refresh");
});

test("hourly checks remove obsolete admin permissions from API and room authorization", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  const env = environment(store);
  const token = store.create(viewer, credentials());
  let calls = 0;
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    calls += 1;
    return Response.json(String(input).endsWith("/users/@me") ? user : { roles: [] });
  });
  assert.equal((await handleRequest(request(token), env)).status, 200);
  assert.equal(calls, 0);
  context.mock.timers.tick(discordCheckInterval);
  const response = await handleRequest(request(token), env);
  assert.deepEqual((await response.json()).user.permissions, []);
  assert.equal(store.read(token)?.viewer.admin, false);
  assert.equal((await handleRequest(request(token, "/api/admin/jellyfin/items"), env)).status, 403);
  assert.equal(
    (await authenticateRoomMember(request(token, "/api/room"), env))?.member.admin,
    false,
  );
  assert.equal(calls, 2);
});

test("leaving the Discord guild revokes the session instead of renewing it", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  const env = environment(store);
  const token = store.create(viewer, credentials());
  context.mock.timers.tick(discordCheckInterval);
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    String(input).endsWith("/users/@me")
      ? Response.json(user)
      : Response.json({ message: "Unknown Member" }, { status: 404 }),
  );
  const response = await handleRequest(request(token), env);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(store.read(token), null);
  assert.equal(await authenticateRoomMember(request(token, "/api/room"), env), null);
});

test("Discord failures preserve the cookie and rotated credentials for a later retry", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  const env = environment(store);
  const token = store.create(viewer, credentials());
  const originalExpiry = store.read(token)?.viewer.expires;
  context.mock.timers.tick(8 * day);
  let unavailable = true;
  let refreshes = 0;
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/oauth2/token")) {
        refreshes += 1;
        return Response.json({
          access_token: "rotated-access",
          refresh_token: "rotated-refresh",
          expires_in: 604800,
        });
      }
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer rotated-access");
      if (unavailable) return Response.json({ message: "Unavailable" }, { status: 503 });
      return Response.json(url.endsWith("/users/@me") ? user : { roles: [] });
    },
  );
  const failed = await handleRequest(request(token), env);
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get("Set-Cookie"), null);
  assert.equal(store.read(token)?.viewer.expires, originalExpiry);
  assert.equal(store.read(token)?.credentials.refreshToken, "rotated-refresh");
  unavailable = false;
  assert.equal((await handleRequest(request(token), env)).status, 200);
  assert.equal(refreshes, 1);
});

test("revoked Discord refresh grants require a fresh login", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  const env = environment(store);
  const token = store.create(viewer, credentials());
  context.mock.timers.tick(8 * day);
  context.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "invalid_grant" }, { status: 400 }),
  );
  const response = await handleRequest(request(token), env);
  assert.equal(response.status, 401);
  assert.equal(store.read(token), null);
});

test("logout requires the app origin and revokes copied cookies on the server", async (context) => {
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  const env = environment(store);
  const token = store.create(viewer, credentials());
  assert.equal(
    (await handleRequest(request(token, "/api/logout", "POST", "https://foreign.test"), env))
      .status,
    403,
  );
  assert.ok(store.read(token));
  const response = await handleRequest(request(token, "/api/logout", "POST"), env);
  assert.equal(response.status, 204);
  assert.match(response.headers.get("Set-Cookie") ?? "", /Max-Age=0/);
  assert.equal((await handleRequest(request(token), env)).status, 401);
});

test("expired sessions cannot be renewed and legacy signed cookies retain their expiry", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  const env = environment(store);
  const expired = store.create(viewer, credentials());
  const legacy = await createSession(viewer, env.SESSION_SECRET);
  const original = await readSession(request(legacy), env.SESSION_SECRET);
  assert.ok(original);
  const response = await handleRequest(request(legacy), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal((await readSession(request(legacy), env.SESSION_SECRET))?.expires, original.expires);
  context.mock.timers.tick(30 * day);
  assert.equal((await handleRequest(request(expired), env)).status, 401);
  assert.equal((await handleRequest(request(legacy), env)).status, 401);
});

test("a Discord check already in flight cannot restore a logged-out session", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  const env = environment(store);
  const token = store.create(viewer, credentials());
  context.mock.timers.tick(discordCheckInterval);
  let release = () => {};
  let started = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const checking = new Promise<void>((resolve) => {
    started = resolve;
  });
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    started();
    await waiting;
    return Response.json(String(input).endsWith("/users/@me") ? user : { roles: ["staff"] });
  });
  const refreshing = handleRequest(request(token), env);
  await checking;
  assert.equal((await handleRequest(request(token, "/api/logout", "POST"), env)).status, 204);
  release();
  const response = await refreshing;
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(store.read(token), null);
});
