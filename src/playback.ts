import type { StreamInfo } from "../shared/stream";

export function bufferedSeconds(video: Pick<HTMLVideoElement, "buffered" | "currentTime">) {
  for (let index = 0; index < video.buffered.length; index++)
    if (
      video.currentTime >= video.buffered.start(index) &&
      video.currentTime <= video.buffered.end(index)
    )
      return video.buffered.end(index) - video.currentTime;
  return 0;
}

export function playbackPresentation(
  status: StreamInfo | null,
  liveReady: boolean,
  startupExpired: boolean,
) {
  const idlePlayback = status?.running === false;
  const playbackAccessError = status?.running ? status.playbackError : undefined;
  return {
    idlePlayback,
    showIdle: !liveReady || idlePlayback,
    startingPlayback:
      status?.running === true && !liveReady && !startupExpired && !playbackAccessError,
    startupFailed: status?.running === true && !liveReady && startupExpired,
    playbackAccessError,
  };
}

export function playbackElapsedSeconds(
  playback: { positionSeconds?: number; updatedAt?: number } | undefined,
  serverTime: number,
  durationSeconds: number | null = null,
): number | null {
  if (
    !playback ||
    !Number.isFinite(playback.positionSeconds) ||
    !Number.isFinite(playback.updatedAt) ||
    !Number.isFinite(serverTime)
  )
    return null;
  const elapsed =
    playback.positionSeconds! +
    Math.max(0, Math.min(15, (serverTime - playback.updatedAt!) / 1000));
  const duration =
    durationSeconds !== null && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : Infinity;
  return Math.floor(Math.max(0, Math.min(elapsed, duration)));
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
