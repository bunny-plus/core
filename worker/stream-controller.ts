import type { Env } from "./env";
import { TtlCache } from "../server/cache";
import { SerialQueue } from "../server/serial-queue";
import { fetchJson } from "../server/upstream";
import { streamPlayback } from "../server/stream-playback";
import { isJellyfinPlayback, jellyfinRuntime } from "../server/jellyfin";
import type { JellyfinPlayback } from "../shared/jellyfin";
import type { StreamInfo, StreamPlaybackError } from "../shared/stream";
import { isJsonObject, isString, type JsonObject, type JsonValue } from "../shared/json";

type ControllerResponse = {
  detail?: string;
  error?: string;
  running?: boolean;
  title?: string | null;
  jellyfin?: JellyfinPlayback | null;
};

function isControllerResponse(value: JsonValue): value is ControllerResponse {
  if (!isJsonObject(value)) return false;
  return (
    (value.detail === undefined || isString(value.detail)) &&
    (value.error === undefined || isString(value.error)) &&
    (value.running === undefined || typeof value.running === "boolean") &&
    (value.title === undefined || value.title === null || isString(value.title)) &&
    (value.jellyfin == null || isJellyfinPlayback(value.jellyfin))
  );
}

const cache = new TtlCache(500);
export const controllerQueue = new SerialQueue();

export async function controller(env: Env, method: "GET" | "POST", body?: JsonObject) {
  const url = env.RELAY_CONTROLLER_URL;
  const secret = env.RELAY_CONTROLLER_SECRET;
  if (!url || !secret) throw new Error("Relay controller is not configured");
  const action = body && "action" in body ? body.action : null;
  const { data: result } = await fetchJson<JsonValue>(url, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    method,
    maxBytes: 256000,
    name: "Stream controller",
    timeoutMs:
      action === "jellyfin" ? 90000 : action === "probe" || action === "restream" ? 30000 : 10000,
  });
  if (!isControllerResponse(result)) throw new Error("Stream controller returned invalid data");
  return result;
}

function streamInfoCacheKey(env: Env) {
  return `stream-info:${env.RELAY_CONTROLLER_URL}:${env.STREAM_URL}:${env.APP_URL}`;
}

type StreamPlaybackAvailability = {
  online: boolean;
  playbackError?: StreamPlaybackError;
};

async function playbackAvailability(env: Env): Promise<StreamPlaybackAvailability> {
  try {
    await streamPlayback(env);
    return { online: true };
  } catch {
    return { online: false, playbackError: "signing-failed" };
  }
}

export async function streamInfo(env: Env) {
  const info = await cache.getOrLoad(streamInfoCacheKey(env), 5, async (): Promise<StreamInfo> => {
    const [relay, upstream] = await Promise.all([
      controllerQueue
        .run(async () => {
          const status = await controller(env, "GET").catch(() => null);
          try {
            await env.CINEMA_DIARY?.observe(
              status?.running === true && !status.error,
              status?.title,
            );
          } catch (error) {
            console.error("Could not update cinema screening", error);
          }
          return status ?? { running: false, title: null };
        })
        .then((status) => ({
          running: status.running === true && !status.error,
          title: status.title ?? null,
          jellyfin: status.running && !status.error ? status.jellyfin : undefined,
        }))
        .catch(() => ({ running: false, title: null, jellyfin: undefined })),
      playbackAvailability(env),
    ]);
    const playback = relay.jellyfin;
    const runtimeSeconds = playback
      ? await cache
          .getOrLoad(
            `jellyfin-runtime:${env.JELLYFIN_URL}:${playback.itemId}:${playback.mediaSourceId}`,
            3600,
            () => jellyfinRuntime(env, playback),
          )
          .catch(() => null)
      : null;
    return runtimeSeconds === null
      ? { ...relay, ...upstream, online: relay.running && upstream.online }
      : { ...relay, ...upstream, online: relay.running && upstream.online, runtimeSeconds };
  });
  if (!env.CINEMA_DIARY) return { ...info, serverTime: Date.now() };
  try {
    return { ...info, serverTime: Date.now(), screening: await env.CINEMA_DIARY.current() };
  } catch (error) {
    console.error("Could not read cinema screening", error);
    return { ...info, serverTime: Date.now() };
  }
}

export async function mutateController(env: Env, body: JsonObject) {
  return controllerQueue.run(async () => {
    const result = await controller(env, "POST", body);
    try {
      if (!result.error) {
        if (
          ["start", "restream", "jellyfin"].includes(String(body.action)) &&
          result.running === true
        )
          await env.CINEMA_DIARY?.start(
            result.title?.trim() || (isString(body.title) ? body.title : null),
          );
        if (body.action === "stop" && result.running === false) await env.CINEMA_DIARY?.stop();
      }
    } catch (error) {
      console.error("Could not update cinema screening", error);
    }
    cache.invalidate(streamInfoCacheKey(env));
    return result;
  });
}
