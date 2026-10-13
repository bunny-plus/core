import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { AuthSessions, discordLoginLifetimeMs } from "./auth-sessions";
const day = 24 * 60 * 60 * 1000;
const viewer = { admin: false, avatar: null, id: "bunny", name: "Bunny", permissions: [] };
const credentials = {
  accessToken: "access-private",
  refreshToken: "refresh-private",
  expiresAt: 7 * day,
};

test("sessions renew for thirty days and cannot revive expired or revoked sign-ins", async (context) => {
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  const token = await store.create(viewer, credentials, 0);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await store.read(token, 29 * day))?.viewer.expires, 30 * day);
  assert.equal(await store.renew(token, 29 * day), true);
  assert.equal((await store.read(token, 58 * day))?.viewer.expires, 59 * day);
  assert.equal(await store.read(token, 59 * day), null);
  assert.equal(await store.renew(token, 59 * day), false);
  const other = await store.create(viewer, credentials, 0);
  await store.revoke(other);
  assert.equal(await store.read(other, day), null);
  assert.equal(await store.renew(other, day), false);
  assert.equal(await store.read(`${token}x`, day), null);
});

test("session credentials survive restarts while database identifiers are hashed", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-sessions-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "sessions.sqlite");
  const store = new AuthSessions(file);
  const token = await store.create(viewer, credentials);
  store.close();
  const database = new DatabaseSync(file);
  const row = database.prepare("SELECT token_hash FROM auth_sessions").get();
  database.close();
  assert.equal(row?.token_hash, createHash("sha256").update(token).digest("hex"));
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const reopened = new AuthSessions(file);
  context.after(() => reopened.close());
  assert.equal((await reopened.read(token))?.viewer.id, "bunny");
  assert.deepEqual((await reopened.read(token))?.credentials, credentials);
});

test("updating Discord claims preserves renewed expiry and cannot restore a logged-out session", async (context) => {
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  const now = Date.now();
  const token = await store.create(viewer, credentials, now);
  const original = await store.read(token, now);
  assert.ok(original);
  assert.ok(await store.renew(token, now + day));
  const updated = { ...original.viewer, name: "New Bunny", permissions: ["chloe.chat"] };
  assert.ok(await store.update(token, updated, credentials));
  assert.equal((await store.read(token))?.viewer.expires, now + 31 * day);
  assert.equal((await store.read(token))?.viewer.name, "New Bunny");
  await store.revoke(token);
  assert.equal(await store.update(token, updated, credentials), false);
});
test("Discord links survive restarts as hashes and cannot sign in another identity", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-login-links-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "sessions.sqlite");
  const store = new AuthSessions(file);
  const token = await store.issueLoginLink(viewer.id);
  store.close();
  const database = new DatabaseSync(file);
  const row = database.prepare("SELECT token_hash FROM discord_login_links").get();
  database.close();
  assert.equal(row?.token_hash, createHash("sha256").update(token).digest("hex"));
  const reopened = new AuthSessions(file);
  context.after(() => reopened.close());
  assert.equal(await reopened.loginUser(token), viewer.id);
  assert.equal(await reopened.redeemLoginLink(token, { ...viewer, id: "another-user" }), null);
  assert.equal(await reopened.loginUser(token), viewer.id);
  const session = await reopened.redeemLoginLink(token, viewer);
  assert.ok(session);
  assert.equal((await reopened.read(session))?.credentials, null);
  assert.equal(await reopened.redeemLoginLink(token, viewer), null);
  const expired = await reopened.issueLoginLink(viewer.id, 0);
  assert.equal(await reopened.redeemLoginLink(expired, viewer, discordLoginLifetimeMs), null);
});
test("adding bot sessions migrates existing OAuth sessions without signing viewers out", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-session-migration-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "sessions.sqlite");
  const database = new DatabaseSync(file);
  database.exec(`CREATE TABLE auth_sessions (
    token_hash TEXT PRIMARY KEY, viewer_json TEXT NOT NULL, access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL, access_expires_at INTEGER NOT NULL, checked_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT`);
  const token = "a".repeat(43);
  const now = Date.now();
  database
    .prepare("INSERT INTO auth_sessions VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(
      createHash("sha256").update(token).digest("hex"),
      JSON.stringify({ ...viewer, expires: now + day }),
      credentials.accessToken,
      credentials.refreshToken,
      credentials.expiresAt,
      now,
      now + day,
    );
  database.close();
  const store = new AuthSessions(file);
  assert.deepEqual((await store.read(token))?.credentials, credentials);
  store.close();
  const reopened = new AuthSessions(file);
  context.after(() => reopened.close());
  assert.equal((await reopened.read(token))?.viewer.id, viewer.id);
});
