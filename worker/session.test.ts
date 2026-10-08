import assert from "node:assert/strict";
import test from "node:test";

import { createSession, readSession, sessionCookie, sessionLifetimeSeconds } from "./session";

test("signed sessions round-trip and reject tampering", async () => {
  const secret = "a sufficiently long test secret";
  const token = await createSession(
    { admin: false, avatar: null, id: "1", name: "Bunny", permissions: [] },
    secret,
  );
  const request = new Request("https://api.bunny.plus", {
    headers: { Cookie: `bp_session=${token}` },
  });
  assert.equal((await readSession(request, secret))?.name, "Bunny");

  const tampered = new Request("https://api.bunny.plus", {
    headers: { Cookie: `bp_session=${token}x` },
  });
  assert.equal(await readSession(tampered, secret), null);
});

test("signed sessions reject structurally invalid claims", async () => {
  const secret = "a sufficiently long test secret";
  const token = await createSession(
    // SAFETY: This test deliberately violates the creation contract to exercise boundary rejection.
    { admin: "yes", avatar: null, id: "1", name: "Bunny", permissions: [] } as never,
    secret,
  );
  const request = new Request("https://api.bunny.plus", {
    headers: { Cookie: `bp_session=${token}` },
  });
  assert.equal(await readSession(request, secret), null);
});

test("session cookies are host-only and can be insecure for local HTTP", () => {
  assert.doesNotMatch(sessionCookie("token"), /Domain=/);
  assert.match(sessionCookie("token"), /; Secure;/);
  assert.match(sessionCookie("token"), /Max-Age=2592000/);
  assert.doesNotMatch(sessionCookie("token", 60, false), /; Secure;/);
});

test("signed sessions and cookies share the thirty-day lifetime", async () => {
  const started = Date.now();
  const token = await createSession(
    { admin: false, avatar: null, id: "1", name: "Bunny", permissions: [] },
    "test-session-secret",
  );
  const viewer = await readSession(
    new Request("https://api.bunny.plus", { headers: { Cookie: `bp_session=${token}` } }),
    "test-session-secret",
  );
  assert.ok(viewer);
  assert.equal(sessionLifetimeSeconds, 30 * 24 * 60 * 60);
  assert.ok(viewer.expires >= started + sessionLifetimeSeconds * 1_000);
  assert.ok(viewer.expires <= Date.now() + sessionLifetimeSeconds * 1_000);
});
