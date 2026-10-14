import type { HlsConfig } from "hls.js";
import type { StreamInfo } from "../shared/stream";

export function playbackPresentation(
  status: StreamInfo | null,
  liveReady: boolean,
  startupExpired: boolean,
) {
  const idlePlayback = status?.running === false;
  const playbackAccessError = status?.running
    ? (status.playbackError ??
      ([401, 403].includes(status.upstreamStatus ?? 0) ? "access-denied" : undefined))
    : undefined;
  return {
    idlePlayback,
    showIdle: !liveReady || idlePlayback,
    startingPlayback:
      status?.running === true && !liveReady && !startupExpired && !playbackAccessError,
    startupFailed: status?.running === true && !liveReady && startupExpired,
    playbackAccessError,
  };
}

type PlaybackMedia = Pick<
  HTMLVideoElement,
  "currentTime" | "buffered" | "readyState" | "seeking" | "paused"
>;

type TimedMedia = Pick<HTMLMediaElement, "currentTime">;

function hasStartDate(media: TimedMedia): media is TimedMedia & { getStartDate: () => Date } {
  return "getStartDate" in media && typeof media.getStartDate === "function";
}

export function mediaProgramDate(media: TimedMedia, playingDate: Date | null): number | null {
  if (playingDate) return playingDate.getTime();
  // Native HLS exposes the date corresponding to media time zero on WebKit.
  if (hasStartDate(media)) return media.getStartDate().getTime() + media.currentTime * 1_000;
  return null;
}

export function playbackElapsedSeconds(
  startedAt: number | null,
  programDate: number | null,
  durationSeconds: number | null = null,
): number | null {
  if (
    startedAt === null ||
    programDate === null ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(programDate)
  )
    return null;
  const duration =
    durationSeconds !== null && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : Infinity;
  return Math.floor(Math.max(0, Math.min((programDate - startedAt) / 1_000, duration)));
}

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

export function playbackConfig(delaySeconds: number, slowConnection: boolean, playbackUrl = "") {
  const protocol = playbackUrl
    ? new URL(playbackUrl, "https://playback.invalid").searchParams.get("protocol")
    : null;
  return {
    lowLatencyMode: protocol === "llhls" || protocol === "llhlsbeta",
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

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "--:--";
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const remainder = whole % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`
    : `${minutes}:${remainder.toString().padStart(2, "0")}`;
}
