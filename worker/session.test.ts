import assert from "node:assert/strict";
import test from "node:test";

import { createSession, readSession, sessionCookie } from "./session";

test("signed sessions round-trip and reject tampering", async () => {
  const secret = "a sufficiently long test secret";
  const token = await createSession({ admin: false, avatar: null, id: "1", name: "Bunny", permissions: [] }, secret);
  const request = new Request("https://api.bunny.plus", { headers: { Cookie: `bp_session=${token}` } });
  assert.equal((await readSession(request, secret))?.name, "Bunny");

  const tampered = new Request("https://api.bunny.plus", { headers: { Cookie: `bp_session=${token}x` } });
  assert.equal(await readSession(tampered, secret), null);
});

test("signed sessions reject structurally invalid claims", async () => {
  const secret = "a sufficiently long test secret";
  const token = await createSession({ admin: "yes", avatar: null, id: "1", name: "Bunny", permissions: [] } as never, secret);
  const request = new Request("https://api.bunny.plus", { headers: { Cookie: `bp_session=${token}` } });
  assert.equal(await readSession(request, secret), null);
});

test("session cookies are host-only and can be insecure for local HTTP", () => {
  assert.doesNotMatch(sessionCookie("token"), /Domain=/);
  assert.match(sessionCookie("token"), /; Secure;/);
  assert.match(sessionCookie("token"), /Max-Age=86400/);
  assert.doesNotMatch(sessionCookie("token", 60, false), /; Secure;/);
});
