import type Hls from "hls.js";
import { useEffect, useState, type RefObject } from "react";
import { bufferedSeconds } from "./playback";

export type PlayerStats = {
  bitrate: number | null;
  latency: number | null;
  targetLatency: number | null;
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
      const details = hls?.latestLevelDetails;
      let latency = details?.live ? details.edge + details.age - video.currentTime : null;
      if (!hls && !video.loop && video.seekable.length)
        latency = video.seekable.end(video.seekable.length - 1) - video.currentTime;
      setStats({
        bitrate: hls?.levels[hls.currentLevel]?.bitrate ?? null,
        latency: latency !== null && Number.isFinite(latency) ? Math.max(0, latency) : null,
        targetLatency: details?.live ? (hls?.targetLatency ?? null) : null,
        buffer: bufferedSeconds(video),
        playtime: video.currentTime,
        resolution: video.videoWidth ? `${video.videoWidth} × ${video.videoHeight}` : "--",
        droppedFrames: video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0,
      });
    }
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [showStats, videoRef, hlsRef]);
  return stats;
}
