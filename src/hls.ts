import type { HlsConfig } from "hls.js";
import type { StreamPlayback } from "../shared/stream";

export const playbackConfig: Partial<HlsConfig> = {
  lowLatencyMode: true,
  liveSyncDuration: 5,
  liveMaxLatencyDuration: 15,
  maxLiveSyncPlaybackRate: 1,
  liveSyncOnStallIncrease: 0,
  maxBufferLength: 5,
  maxMaxBufferLength: 10,
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
