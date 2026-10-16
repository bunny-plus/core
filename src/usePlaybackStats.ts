import { useEffect, useState, type RefObject } from "react";

export type PlayerStats = {
  bitrate: number | null;
  jitter: number | null;
  roundTrip: number | null;
  packetsLost: number | null;
  droppedFrames: number;
  playtime: number;
  resolution: string;
};

export function usePlaybackStats(
  videoRef: RefObject<HTMLVideoElement | null>,
  peerRef: RefObject<RTCPeerConnection | null>,
  showStats: boolean,
) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  useEffect(() => {
    if (!showStats) return;
    let disposed = false;
    let pending = false;
    let previous: { peer: RTCPeerConnection; bytes: number; time: number } | undefined;
    async function update() {
      if (pending) return;
      const video = videoRef.current;
      if (!video) return;
      pending = true;
      try {
        const peer = !video.loop ? peerRef.current : null;
        const report = peer && peer.connectionState !== "closed" ? await peer.getStats() : null;
        const next: PlayerStats = {
          bitrate: null,
          jitter: null,
          roundTrip: null,
          packetsLost: null,
          playtime: video.currentTime,
          resolution: video.videoWidth ? `${video.videoWidth} × ${video.videoHeight}` : "--",
          droppedFrames: video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0,
        };
        report?.forEach((value) => {
          if (value.type === "inbound-rtp" && value.kind === "video" && peer) {
            const incoming = value as RTCInboundRtpStreamStats;
            if (
              previous?.peer === peer &&
              incoming.bytesReceived !== undefined &&
              incoming.timestamp > previous.time
            )
              next.bitrate = Math.max(
                0,
                ((incoming.bytesReceived - previous.bytes) * 8000) /
                  (incoming.timestamp - previous.time),
              );
            if (incoming.bytesReceived !== undefined)
              previous = { peer, bytes: incoming.bytesReceived, time: incoming.timestamp };
            next.jitter = incoming.jitter ?? null;
            next.packetsLost = incoming.packetsLost ?? null;
            next.droppedFrames = incoming.framesDropped ?? next.droppedFrames;
          }
          if (value.type === "candidate-pair" && value.nominated && value.state === "succeeded")
            next.roundTrip = value.currentRoundTripTime ?? null;
        });
        if (!disposed) setStats(next);
      } catch {
      } finally {
        pending = false;
      }
    }
    void update();
    const timer = setInterval(update, 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [showStats, videoRef, peerRef]);
  return stats;
}
