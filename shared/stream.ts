import type { JellyfinPlayback } from "./jellyfin";

export type StreamPlayback = { sdp: string; session: string };

export type StreamPlaybackError = "access-denied" | "signing-failed";

export type StreamStatus = {
  running: boolean;
  title: string | null;
};

export type StreamInfo = StreamStatus & {
  serverTime?: number;
  jellyfin?: JellyfinPlayback | null;
  online: boolean;
  playbackError?: StreamPlaybackError;
  runtimeSeconds?: number;
};
