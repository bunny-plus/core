import type { Env } from "../worker/env";
import { TtlCache } from "./cache";
import { isJsonObject, isString, type JsonValue } from "../shared/json";

type StreamEnvironment = Pick<
  Env,
  "STREAM_URL" | "CLOUDFLARE_STREAM_SIGNING_KEY_ID" | "CLOUDFLARE_STREAM_SIGNING_KEY_JWK"
>;

const playbackCache = new TtlCache(50);

function liveInput(url: URL) {
  const match = /^\/([a-f\d]{32})\/webRTC\/play$/.exec(url.pathname);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".cloudflarestream.com") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match
  ) {
    throw new Error("Signed playback requires a private WHEP URL with a live input ID");
  }
  return match[1];
}

export function validateStreamSigning(env: StreamEnvironment) {
  const url = new URL(env.STREAM_URL);
  if (!url.hostname.endsWith(".cloudflarestream.com")) {
    if (env.CLOUDFLARE_STREAM_SIGNING_KEY_ID || env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK)
      throw new Error("Signing requires a private WHEP URL");
    return;
  }
  liveInput(url);
  if (!env.CLOUDFLARE_STREAM_SIGNING_KEY_ID || !env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK)
    throw new Error("WebRTC playback requires both signing key ID and private JWK");
  if (!/^[a-z\d_-]{1,128}$/i.test(env.CLOUDFLARE_STREAM_SIGNING_KEY_ID))
    throw new Error("CLOUDFLARE_STREAM_SIGNING_KEY_ID is invalid");
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function signLocally(inputId: string, keyId: string, encodedKey: string, expires: number) {
  try {
    const parsed: JsonValue = JSON.parse(
      encodedKey.startsWith("{") ? encodedKey : atob(encodedKey),
    );
    if (
      !isJsonObject(parsed) ||
      parsed.kty !== "RSA" ||
      !isString(parsed.n) ||
      !isString(parsed.e) ||
      !isString(parsed.d)
    )
      throw new Error("Invalid private JWK");
    const key = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "RSA",
        n: parsed.n,
        e: parsed.e,
        d: parsed.d,
        p: isString(parsed.p) ? parsed.p : undefined,
        q: isString(parsed.q) ? parsed.q : undefined,
        dp: isString(parsed.dp) ? parsed.dp : undefined,
        dq: isString(parsed.dq) ? parsed.dq : undefined,
        qi: isString(parsed.qi) ? parsed.qi : undefined,
      },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const encoder = new TextEncoder();
    const header = base64Url(encoder.encode(JSON.stringify({ alg: "RS256", kid: keyId })));
    const claims = base64Url(
      encoder.encode(
        JSON.stringify({
          sub: inputId,
          kid: keyId,
          exp: expires,
          nbf: Math.floor(Date.now() / 1000) - 30,
        }),
      ),
    );
    const message = `${header}.${claims}`;
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(message));
    return `${message}.${base64Url(new Uint8Array(signature))}`;
  } catch {
    throw new Error("Playback signing key is invalid");
  }
}

export async function streamPlayback(env: StreamEnvironment): Promise<string> {
  validateStreamSigning(env);
  if (!env.CLOUDFLARE_STREAM_SIGNING_KEY_ID || !env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK)
    return env.STREAM_URL;
  const keyId = env.CLOUDFLARE_STREAM_SIGNING_KEY_ID;
  const jwk = env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK;
  const cacheKey = JSON.stringify([env.STREAM_URL, keyId, jwk]);
  return playbackCache.getOrLoad(cacheKey, 45 * 60, async () => {
    const url = new URL(env.STREAM_URL);
    const token = await signLocally(
      liveInput(url),
      keyId,
      jwk,
      Math.floor(Date.now() / 1000) + 3600,
    );
    url.pathname = `/${token}/webRTC/play`;
    return url.toString();
  });
}
