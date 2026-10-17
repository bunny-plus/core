import type Hls from "hls.js";
import { useEffect, useState, type RefObject } from "react";
import { bufferedSeconds } from "./playback";

export type PlayerStats = {
  bitrate: number | null;
  latency: number | null;
  buffer: number;
  droppedFrames: number;
  playtime: number;
  resolution: string;
};

export function usePlaybackStats(
  videoRef: RefObject<HTMLVideoElement | null>,
  hlsRef: RefObject<Hls | null>,
  showStats: boolean,
) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  useEffect(() => {
    if (!showStats) return;
    function update() {
      const video = videoRef.current;
      if (!video) return;
      const hls = !video.loop ? hlsRef.current : null;
      setStats({
        bitrate: hls?.levels[hls.currentLevel]?.bitrate ?? null,
        latency: hls && Number.isFinite(hls.latency) ? hls.latency : null,
        buffer: bufferedSeconds(video),
        playtime: video.currentTime,
        resolution: video.videoWidth ? `${video.videoWidth} × ${video.videoHeight}` : "--",
        droppedFrames: video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0,
      });
    }
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [showStats, videoRef, hlsRef]);
  return stats;
}
