import { useEffect, useState, type RefObject } from "react";
import { videoMetrics, type VideoSample } from "./webrtc-stats";

export type PlayerStats = ReturnType<typeof videoMetrics> & {
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastPeer: RTCPeerConnection | null = null;
    let samples: VideoSample[] = [];
    async function update() {
      try {
        const video = videoRef.current;
        if (!video) return;
        const peer = !video.loop ? peerRef.current : null;
        if (peer !== lastPeer) samples = [];
        lastPeer = peer;
        let sample: VideoSample | undefined;
        if (peer && peer.connectionState !== "closed") {
          const report = await peer.getStats();
          if (disposed || peer !== peerRef.current || video !== videoRef.current) return;
          report.forEach((entry) => {
            if (entry.type === "inbound-rtp" && (entry.kind ?? entry.mediaType) === "video")
              sample = entry as VideoSample;
          });
        }
        const previous = samples.at(-1);
        if (
          sample &&
          (sample.id !== previous?.id ||
            sample.timestamp <= previous.timestamp ||
            (sample.framesDecoded ?? 0) < (previous.framesDecoded ?? 0) ||
            (sample.bytesReceived ?? 0) < (previous.bytesReceived ?? 0))
        )
          samples = [];
        const metrics = videoMetrics(sample ?? { id: "idle", timestamp: 0 }, samples[0]);
        if (sample) {
          samples.push(sample);
          while (samples.length > 1 && samples[1].timestamp <= sample.timestamp - 2000)
            samples.shift();
        }
        setStats({
          ...metrics,
          droppedFrames:
            metrics.droppedFrames ?? video.getVideoPlaybackQuality?.().droppedVideoFrames ?? null,
          playtime: video.currentTime,
          resolution: video.videoWidth ? `${video.videoWidth} × ${video.videoHeight}` : "--",
        });
      } catch {
        samples = [];
      } finally {
        if (!disposed) timer = setTimeout(update, 500);
      }
    }
    void update();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [showStats, videoRef, peerRef]);
  return stats;
}
