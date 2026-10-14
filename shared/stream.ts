import type { JellyfinPlayback } from "./jellyfin";

export type StreamPlayback = { expiresAt: number | null; url: string };

export type StreamPlaybackError = "access-denied" | "signing-failed";

export type StreamStatus = {
  running: boolean;
  title: string | null;
};

export type StreamInfo = StreamStatus & {
  jellyfin?: JellyfinPlayback | null;
  online: boolean;
  playbackError?: StreamPlaybackError;
  runtimeSeconds?: number;
  upstreamStatus: number | null;
};
