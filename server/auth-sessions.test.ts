import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { AuthSessions } from "./auth-sessions";

const day = 24 * 60 * 60 * 1_000;
const viewer = { admin: false, avatar: null, id: "bunny", name: "Bunny", permissions: [] };
const credentials = {
  accessToken: "access-private",
  refreshToken: "refresh-private",
  expiresAt: 7 * day,
};

test("sessions renew for thirty days and cannot revive expired or revoked sign-ins", (context) => {
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  const token = store.create(viewer, credentials, 0);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(store.read(token, 29 * day)?.viewer.expires, 30 * day);
  assert.equal(store.renew(token, 29 * day), true);
  assert.equal(store.read(token, 58 * day)?.viewer.expires, 59 * day);
  assert.equal(store.read(token, 59 * day), null);
  assert.equal(store.renew(token, 59 * day), false);
  const other = store.create(viewer, credentials, 0);
  store.revoke(other);
  assert.equal(store.read(other, day), null);
  assert.equal(store.renew(other, day), false);
  assert.equal(store.read(`${token}x`, day), null);
});

test("session credentials survive restarts while database identifiers are hashed", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-sessions-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "sessions.sqlite");
  const store = new AuthSessions(file);
  const token = store.create(viewer, credentials);
  store.close();
  const database = new DatabaseSync(file);
  const row = database.prepare("SELECT token_hash FROM auth_sessions").get();
  database.close();
  assert.equal(row?.token_hash, createHash("sha256").update(token).digest("hex"));
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const reopened = new AuthSessions(file);
  context.after(() => reopened.close());
  assert.equal(reopened.read(token)?.viewer.id, "bunny");
  assert.deepEqual(reopened.read(token)?.credentials, credentials);
});

test("updating Discord claims preserves renewed expiry and cannot restore a logged-out session", (context) => {
  const store = new AuthSessions(":memory:");
  context.after(() => store.close());
  const now = Date.now();
  const token = store.create(viewer, credentials, now);
  const original = store.read(token, now);
  assert.ok(original);
  assert.ok(store.renew(token, now + day));
  const updated = { ...original.viewer, name: "New Bunny", permissions: ["chloe.chat"] };
  assert.ok(store.update(token, updated, credentials));
  assert.equal(store.read(token)?.viewer.expires, now + 31 * day);
  assert.equal(store.read(token)?.viewer.name, "New Bunny");
  store.revoke(token);
  assert.equal(store.update(token, updated, credentials), false);
});
