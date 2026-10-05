import type { HlsConfig } from "hls.js";

type PlaybackMedia = Pick<
  HTMLVideoElement,
  "currentTime" | "buffered" | "readyState" | "seeking" | "paused"
>;

function bufferedAhead(ranges: TimeRanges, position: number) {
  for (let index = 0; index < ranges.length; index++) {
    if (position >= ranges.start(index) && position <= ranges.end(index))
      return ranges.end(index) - position;
  }
  return 0;
}

export class PlaybackSynchronizer {
  private driftSince: number | null = null;
  private direction = 0;
  private lastSeek = -Infinity;

  update(media: PlaybackMedia, target: number | null, now: number, followLive = true) {
    if (!followLive) {
      this.driftSince = null;
      return { label: "Slow connection · sync off", position: null, rate: 1 };
    }
    const drift = target === null ? NaN : target - media.currentTime;
    const following = { label: "Following the live room", position: null, rate: 1 };
    if (!Number.isFinite(drift) || media.seeking || media.paused || media.readyState < 3) {
      this.driftSince = null;
      return following;
    }
    if (Math.abs(drift) <= 5) {
      this.driftSince = null;
      return {
        ...following,
        label: Math.abs(drift) < 0.75 ? "Synced to the live room" : following.label,
      };
    }
    if (this.driftSince === null || Math.sign(drift) !== this.direction) {
      this.driftSince = now;
      this.direction = Math.sign(drift);
    }
    // Give jitter time to settle, and never seek into a buffer gap or starve playback.
    if (
      target === null ||
      now - this.driftSince < 3_000 ||
      now - this.lastSeek < 15_000 ||
      bufferedAhead(media.buffered, media.currentTime) < 1 ||
      bufferedAhead(media.buffered, target) < 2
    )
      return following;
    this.lastSeek = now;
    this.driftSince = null;
    return { label: "Resyncing to the live room", position: target, rate: 1 };
  }
}

export function playbackConfig(delaySeconds: number, slowConnection: boolean) {
  return {
    lowLatencyMode: false,
    maxLiveSyncPlaybackRate: 1,
    backBufferLength: 10,
    liveSyncDuration: slowConnection ? Math.max(delaySeconds, 18) : delaySeconds,
    liveMaxLatencyDuration: slowConnection
      ? Infinity
      : Math.max(delaySeconds + 15, delaySeconds * 2),
    maxBufferLength: slowConnection ? 24 : 12,
    maxMaxBufferLength: slowConnection ? 30 : 20,
    abrMaxWithRealBitrate: true,
  } satisfies Partial<HlsConfig>;
}
