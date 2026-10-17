import assert from "node:assert/strict";
import test from "node:test";
import { streamPlayback, validateStreamSigning } from "./stream-playback";
const inputId = "a".repeat(32);
const streamUrl = `https://customer-test.cloudflarestream.com/${inputId}/manifest/video.m3u8?protocol=llhlsbeta`;

test("private HLS requires a complete local signing key and never falls back to API tokens or unsigned playback", async () => {
  assert.throws(
    () => validateStreamSigning({ STREAM_URL: streamUrl }),
    /both signing key ID and private JWK/,
  );
  await assert.rejects(
    streamPlayback({ STREAM_URL: streamUrl }),
    /both signing key ID and private JWK/,
  );
  assert.throws(
    () =>
      validateStreamSigning({
        STREAM_URL: streamUrl.replace("manifest/video.m3u8", "webRTC/play"),
      }),
    /private HLS URL/,
  );
  assert.throws(
    () => validateStreamSigning({ STREAM_URL: streamUrl + "&private=secret" }),
    /private HLS URL/,
  );
  assert.deepEqual(await streamPlayback({ STREAM_URL: "http://localhost:8888/stream.m3u8" }), {
    url: "http://localhost:8888/stream.m3u8",
    expiresAt: null,
  });
  await assert.rejects(
    streamPlayback({
      STREAM_URL: streamUrl,
      CLOUDFLARE_STREAM_SIGNING_KEY_ID: "invalid",
      CLOUDFLARE_STREAM_SIGNING_KEY_JWK: "private-invalid-key",
    }),
    { message: "Playback signing key is invalid" },
  );
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
    assert.equal(url.search, "?protocol=llhlsbeta");
    assert.ok(url.pathname.endsWith("/manifest/video.m3u8"));
    const [header, claims, signature] = url.pathname.split("/")[1].split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), {
      alg: "RS256",
      kid: "registered-key",
    });
    const payload = JSON.parse(Buffer.from(claims, "base64url").toString());
    assert.equal(payload.sub, inputId);
    assert.equal(payload.kid, "registered-key");
    assert.equal(playback.expiresAt, payload.exp * 1000);
    assert.ok(payload.nbf >= before - 30 && payload.nbf <= Math.floor(Date.now() / 1000));
    assert.ok(payload.exp >= before + 3600 && payload.exp <= Math.floor(Date.now() / 1000) + 3600);
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
