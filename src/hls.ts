import type { HlsConfig } from "hls.js";
import type { StreamPlayback } from "../shared/stream";

export const playbackConfig: Partial<HlsConfig> = {
  lowLatencyMode: false,
  liveSyncDuration: 6,
  liveMaxLatencyDuration: 15,
  liveSyncMode: "buffered",
  maxLiveSyncPlaybackRate: 1,
  liveSyncOnStallIncrease: 1,
  maxBufferLength: 12,
  maxMaxBufferLength: 20,
  backBufferLength: 10,
};

export function playbackAuthorization(authorize: () => Promise<StreamPlayback>) {
  let current: StreamPlayback | undefined;
  let pending: Promise<StreamPlayback> | undefined;
  const prefixes = new Set<string>();
  const prefix = (url: string) => url.slice(0, url.indexOf("/manifest/"));

  async function get() {
    if (current && (current.expiresAt === null || current.expiresAt > Date.now() + 120_000))
      return current;
    if (!pending)
      pending = authorize()
        .then((playback) => {
          current = playback;
          if (playback.url.includes("/manifest/")) prefixes.add(prefix(playback.url));
          return playback;
        })
        .finally(() => {
          pending = undefined;
        });
    return pending;
  }

  async function requestUrl(source: string) {
    if (![...prefixes].some((value) => source.startsWith(`${value}/`))) return source;
    const playback = await get();
    for (const value of prefixes)
      if (source.startsWith(`${value}/`)) return prefix(playback.url) + source.slice(value.length);
    return source;
  }

  return { get, requestUrl };
}
