import type { Env } from "../worker/index";
import type { StreamPlayback } from "../shared/stream";
import { TtlCache } from "./cache";
import { fetchJson, UpstreamError, type JsonObject, type JsonValue } from "./upstream";

type StreamEnvironment = Pick<
  Env,
  | "STREAM_URL"
  | "CLOUDFLARE_STREAM_ACCOUNT_ID"
  | "CLOUDFLARE_STREAM_API_TOKEN"
  | "CLOUDFLARE_STREAM_SIGNING_KEY_ID"
  | "CLOUDFLARE_STREAM_SIGNING_KEY_JWK"
>;

const playbackCache = new TtlCache(50);
export const streamApiBaseUrl = "https://api.cloudflare.com/client/v4/accounts";

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function liveInput(url: URL) {
  const match = /^\/([a-f\d]{32})\/manifest\/video\.m3u8$/.exec(url.pathname);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".cloudflarestream.com") ||
    url.username ||
    url.password ||
    !match
  ) {
    throw new Error("Signed playback requires a private HLS URL with a live input ID");
  }
  return match[1];
}

export function streamInputId(source: string) {
  return liveInput(new URL(source));
}

export function validateStreamSigning(env: StreamEnvironment) {
  const api = Boolean(env.CLOUDFLARE_STREAM_ACCOUNT_ID || env.CLOUDFLARE_STREAM_API_TOKEN);
  const key = Boolean(
    env.CLOUDFLARE_STREAM_SIGNING_KEY_ID || env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK,
  );
  const url = new URL(env.STREAM_URL);
  if (!api && !key) {
    if (url.hostname.endsWith(".cloudflarestream.com"))
      throw new Error("Private playback requires signing credentials");
    return;
  }
  liveInput(url);
  if (api) {
    if (!env.CLOUDFLARE_STREAM_ACCOUNT_ID || !env.CLOUDFLARE_STREAM_API_TOKEN)
      throw new Error("Playback API signing requires both account ID and API token");
    if (!/^[a-f\d]{32}$/i.test(env.CLOUDFLARE_STREAM_ACCOUNT_ID))
      throw new Error("CLOUDFLARE_STREAM_ACCOUNT_ID must be a 32-character account ID");
    if (!/^[\x21-\x7e]{20,512}$/.test(env.CLOUDFLARE_STREAM_API_TOKEN))
      throw new Error("CLOUDFLARE_STREAM_API_TOKEN must be a valid API token");
  }
  if (key) {
    if (!env.CLOUDFLARE_STREAM_SIGNING_KEY_ID || !env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK)
      throw new Error("Local playback signing requires both signing key ID and private JWK");
    if (!/^[a-z\d_-]{1,128}$/i.test(env.CLOUDFLARE_STREAM_SIGNING_KEY_ID))
      throw new Error("CLOUDFLARE_STREAM_SIGNING_KEY_ID is invalid");
  }
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
      !isObject(parsed) ||
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

export async function streamPlayback(env: StreamEnvironment): Promise<StreamPlayback> {
  validateStreamSigning(env);
  if (!env.CLOUDFLARE_STREAM_API_TOKEN && !env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK)
    return { expiresAt: null, url: env.STREAM_URL };

  const cacheKey = JSON.stringify([
    env.STREAM_URL,
    env.CLOUDFLARE_STREAM_ACCOUNT_ID,
    env.CLOUDFLARE_STREAM_API_TOKEN,
    env.CLOUDFLARE_STREAM_SIGNING_KEY_ID,
    env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK,
  ]);
  return playbackCache.getOrLoad(cacheKey, 45 * 60, async () => {
    const url = new URL(env.STREAM_URL);
    const inputId = liveInput(url);
    const expires = Math.floor(Date.now() / 1000) + 60 * 60;
    let token: string;
    if (env.CLOUDFLARE_STREAM_SIGNING_KEY_ID && env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK) {
      token = await signLocally(
        inputId,
        env.CLOUDFLARE_STREAM_SIGNING_KEY_ID,
        env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK,
        expires,
      );
    } else {
      const { data } = await fetchJson<JsonValue>(
        `${streamApiBaseUrl}/${env.CLOUDFLARE_STREAM_ACCOUNT_ID}/stream/${inputId}/token`,
        {
          body: JSON.stringify({ exp: expires }),
          headers: {
            Authorization: `Bearer ${env.CLOUDFLARE_STREAM_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          maxBytes: 32_000,
          name: "Playback authorization",
          timeoutMs: 5_000,
        },
      );
      if (
        !isObject(data) ||
        data.success !== true ||
        !data.result ||
        !isObject(data.result) ||
        !isString(data.result.token) ||
        !/^[a-z\d_-]+\.[a-z\d_-]+\.[a-z\d_-]+$/i.test(data.result.token)
      )
        throw new UpstreamError("Playback service returned an invalid playback token");
      token = data.result.token;
    }
    url.pathname = `/${token}/manifest/video.m3u8`;
    return { expiresAt: expires * 1000, url: url.toString() };
  });
}
