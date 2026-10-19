import type { Env } from "../worker/env";
import type { StreamPlayback } from "../shared/stream";
import { isJsonObject, isInteger, isString, type JsonValue } from "../shared/json";
import { ClientError } from "../worker/http";
import { readBoundedBytes } from "./upstream";
import { streamPlayback } from "./stream-playback";

type PlaybackEnvironment = Pick<
  Env,
  | "STREAM_URL"
  | "SESSION_SECRET"
  | "APP_URL"
  | "CLOUDFLARE_STREAM_SIGNING_KEY_ID"
  | "CLOUDFLARE_STREAM_SIGNING_KEY_JWK"
>;
const encoder = new TextEncoder();

async function sessionKey(secret: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`bunny-playback-session:${secret}`),
  );
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function sessionUrl(location: string, endpoint: string) {
  const url = new URL(location, endpoint);
  if (url.origin !== new URL(endpoint).origin || url.username || url.password || url.hash)
    throw new Error("Playback service returned an invalid session");
  return url.toString();
}

async function sealSession(url: string, viewerId: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = encoder.encode(
    JSON.stringify({ url, viewerId, expires: Date.now() + 24 * 60 * 60 * 1000 }),
  );
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sessionKey(secret), body),
  );
  const bytes = new Uint8Array(iv.length + encrypted.length);
  bytes.set(iv);
  bytes.set(encrypted, iv.length);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function closeUpstream(url: string) {
  try {
    const response = await fetch(url, {
      method: "DELETE",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    await response.body?.cancel();
    if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error();
  } catch {
    throw new Error("Could not close the playback session");
  }
}

export async function startPlayback(
  env: PlaybackEnvironment,
  viewerId: string,
  offer: string,
): Promise<StreamPlayback> {
  if (!offer.startsWith("v=0") || encoder.encode(offer).length > 64_000)
    throw new ClientError("Invalid playback offer", 400);
  const endpoint = await streamPlayback(env);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/sdp", Origin: new URL(env.APP_URL).origin },
      body: offer,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ClientError("The stream is not ready. Reconnecting…", 503);
  }
  if (!response.ok) {
    await response.body?.cancel();
    if ([401, 403].includes(response.status))
      throw new ClientError("Playback access was denied", 403);
    throw new ClientError("The stream is not ready. Reconnecting…", 503);
  }
  const location = response.headers.get("Location");
  if (!location) {
    await response.body?.cancel();
    throw new Error("Playback service did not return a session");
  }
  const resource = sessionUrl(location, endpoint);
  try {
    const sdp = new TextDecoder().decode(await readBoundedBytes(response, 64_000, "Playback"));
    if (!sdp.startsWith("v=0")) throw new Error("Playback service returned an invalid answer");
    return { sdp, session: await sealSession(resource, viewerId, env.SESSION_SECRET) };
  } catch (error) {
    await closeUpstream(resource).catch(() => {});
    throw error;
  }
}

export async function stopPlayback(env: PlaybackEnvironment, viewerId: string, token: string) {
  let url: string;
  try {
    if (!/^[A-Za-z\d_-]{40,16000}$/.test(token)) throw new Error();
    const bytes = Uint8Array.from(atob(token.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
      c.charCodeAt(0),
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      await sessionKey(env.SESSION_SECRET),
      bytes.slice(12),
    );
    const data: JsonValue = JSON.parse(new TextDecoder().decode(plaintext));
    if (
      !isJsonObject(data) ||
      !isString(data.url) ||
      data.viewerId !== viewerId ||
      !isInteger(data.expires) ||
      data.expires <= Date.now()
    )
      throw new Error();
    url = sessionUrl(data.url, env.STREAM_URL);
  } catch {
    throw new ClientError("Invalid playback session", 400);
  }
  await closeUpstream(url);
}
