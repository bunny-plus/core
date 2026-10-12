import assert from "node:assert/strict";
import test from "node:test";

import { streamPlayback, validateStreamSigning } from "./stream-playback";

const inputId = "a".repeat(32);
const streamUrl = `https://customer-test.cloudflarestream.com/${inputId}/manifest/video.m3u8?protocol=llhlsbeta`;
const apiEnvironment = {
  CLOUDFLARE_STREAM_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_STREAM_API_TOKEN: "test-cloudflare-api-token",
  STREAM_URL: streamUrl,
};

test("private playback cannot fall back to exposing its unsigned source URL", async () => {
  assert.throws(() => validateStreamSigning({ STREAM_URL: streamUrl }), /signing credentials/);
  await assert.rejects(() => streamPlayback({ STREAM_URL: streamUrl }), /signing credentials/);
});

test("unsigned feeds retain their URL and signing configuration requires complete pairs", async () => {
  assert.deepEqual(await streamPlayback({ STREAM_URL: "http://localhost/live.m3u8" }), {
    expiresAt: null,
    url: "http://localhost/live.m3u8",
  });
  assert.throws(
    () => validateStreamSigning({ STREAM_URL: streamUrl, CLOUDFLARE_STREAM_API_TOKEN: "token" }),
    /both account ID and API token/,
  );
  assert.throws(
    () => validateStreamSigning({ STREAM_URL: streamUrl, CLOUDFLARE_STREAM_SIGNING_KEY_ID: "key" }),
    /both signing key ID and private JWK/,
  );
  assert.throws(
    () => validateStreamSigning({ ...apiEnvironment, STREAM_URL: "https://other.test/live.m3u8" }),
    /private HLS URL/,
  );
  assert.throws(
    () => validateStreamSigning({ ...apiEnvironment, CLOUDFLARE_STREAM_ACCOUNT_ID: "../account" }),
    /32-character account ID/,
  );
  assert.throws(
    () =>
      validateStreamSigning({ ...apiEnvironment, CLOUDFLARE_STREAM_API_TOKEN: "bad\r\nheader" }),
    /valid API token/,
  );
});

test("API signing coalesces requests, ignores unrelated environment fields, and renews before expiry", async (context) => {
  let now = 1_900_000_000_000;
  context.mock.method(Date, "now", () => now);
  const requests: { url: string; init?: RequestInit }[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return Response.json({
        success: true,
        result: { token: `header.claims.signature${requests.length}` },
      });
    },
  );
  type Unrelated = { cycle?: Unrelated };
  const unrelated: Unrelated = {};
  unrelated.cycle = unrelated;
  const withRuntimeState = { ...apiEnvironment, unrelated };
  const first = await Promise.all([
    streamPlayback(withRuntimeState),
    streamPlayback(apiEnvironment),
  ]);
  assert.equal(requests.length, 1);
  assert.deepEqual(first[0], first[1]);
  assert.equal(first[0].expiresAt, now + 60 * 60 * 1000);
  assert.equal(
    first[0].url,
    "https://customer-test.cloudflarestream.com/header.claims.signature1/manifest/video.m3u8?protocol=llhlsbeta",
  );
  assert.equal(
    requests[0].url,
    `https://api.cloudflare.com/client/v4/accounts/${apiEnvironment.CLOUDFLARE_STREAM_ACCOUNT_ID}/stream/${inputId}/token`,
  );
  assert.equal(requests[0].init?.method, "POST");
  assert.equal(
    new Headers(requests[0].init?.headers).get("Authorization"),
    `Bearer ${apiEnvironment.CLOUDFLARE_STREAM_API_TOKEN}`,
  );
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { exp: now / 1000 + 3600 });
  now += 44 * 60 * 1000;
  assert.deepEqual(await streamPlayback(apiEnvironment), first[0]);
  now += 2 * 60 * 1000;
  const renewed = await streamPlayback(apiEnvironment);
  assert.equal(requests.length, 2);
  assert.equal(renewed.expiresAt, now + 60 * 60 * 1000);
  assert.notEqual(renewed.url, first[0].url);
});

test("local signing produces a verifiable RSA token from raw and base64 JWKs without an API call", async (context) => {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  );
  const jwk = JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey));
  context.mock.method(globalThis, "fetch", () => {
    throw new Error("Local signing must not call Cloudflare");
  });
  for (const encoded of [jwk, btoa(jwk)]) {
    const before = Math.floor(Date.now() / 1000);
    const playback = await streamPlayback({
      STREAM_URL: streamUrl,
      CLOUDFLARE_STREAM_SIGNING_KEY_ID: "registered-key",
      CLOUDFLARE_STREAM_SIGNING_KEY_JWK: encoded,
    });
    const url = new URL(playback.url);
    assert.equal(url.searchParams.get("protocol"), "llhlsbeta");
    const [header, claims, signature] = url.pathname.split("/")[1].split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), {
      alg: "RS256",
      kid: "registered-key",
    });
    const payload = JSON.parse(Buffer.from(claims, "base64url").toString());
    assert.equal(payload.sub, inputId);
    assert.equal(payload.kid, "registered-key");
    assert.ok(payload.nbf >= before - 30 && payload.nbf <= Math.floor(Date.now() / 1000));
    assert.ok(payload.exp >= before + 3600 && payload.exp <= Math.floor(Date.now() / 1000) + 3600);
    assert.equal(playback.expiresAt, payload.exp * 1000);
    assert.equal(
      await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        keys.publicKey,
        new Uint8Array(Buffer.from(signature, "base64url")),
        new TextEncoder().encode(`${header}.${claims}`),
      ),
      true,
    );
  }
});

test("signing failures do not disclose upstream bodies or private credentials and can be retried", async (context) => {
  const environment = {
    ...apiEnvironment,
    CLOUDFLARE_STREAM_API_TOKEN: "another-secret-api-token",
  };
  let attempts = 0;
  context.mock.method(globalThis, "fetch", async () => {
    attempts += 1;
    return attempts === 1
      ? Response.json({ secret: environment.CLOUDFLARE_STREAM_API_TOKEN }, { status: 403 })
      : Response.json({ success: true, result: { token: "header.claims.signature" } });
  });
  await assert.rejects(streamPlayback(environment), {
    message: "Playback authorization request failed (403)",
  });
  assert.ok((await streamPlayback(environment)).url.includes("/header.claims.signature/"));
  assert.equal(attempts, 2);
  await assert.rejects(
    streamPlayback({
      STREAM_URL: streamUrl,
      CLOUDFLARE_STREAM_SIGNING_KEY_ID: "invalid-key",
      CLOUDFLARE_STREAM_SIGNING_KEY_JWK: "private-key-material",
    }),
    { message: "Playback signing key is invalid" },
  );
});

test("API signing rejects invalid or unsuccessful token responses", async (context) => {
  for (const [index, data] of [
    { success: false, result: { token: "header.claims.signature" } },
    { success: true, result: { token: "../another/path?secret" } },
    { success: true, result: {} },
  ].entries()) {
    context.mock.method(globalThis, "fetch", async () => Response.json(data));
    await assert.rejects(
      streamPlayback({
        ...apiEnvironment,
        CLOUDFLARE_STREAM_API_TOKEN: `invalid-response-token-${index}`,
      }),
      { message: "Playback service returned an invalid playback token" },
    );
  }
});
