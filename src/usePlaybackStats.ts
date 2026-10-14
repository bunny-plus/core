import type Hls from "hls.js";
import { useEffect, useState, type RefObject } from "react";

export type PlayerStats = {
  bandwidth: number | null;
  mediaBitrate: number | null;
  bufferAhead: number;
  bufferTotal: number;
  delay: number | null;
  droppedFrames: number;
  playtime: number;
  rate: number;
  resolution: string;
  seekableWindow: number;
};

export function usePlaybackStats(
  videoRef: RefObject<HTMLVideoElement | null>,
  hlsRef: RefObject<Hls | null>,
  clockOffsetRef: RefObject<number>,
  showStats: boolean,
) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  useEffect(() => {
    if (!showStats) return;

    function updateStats() {
      const video = videoRef.current;
      if (!video) return;

      let bufferAhead = 0;
      let bufferTotal = 0;
      for (let index = 0; index < video.buffered.length; index++) {
        const start = video.buffered.start(index);
        const end = video.buffered.end(index);
        bufferTotal += end - start;
        if (video.currentTime >= start && video.currentTime <= end)
          bufferAhead = end - video.currentTime;
      }

      const hls = video.loop ? null : hlsRef.current;
      const playingDate = hls?.playingDate;
      const liveEdge =
        video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : null;
      const delay = video.loop
        ? null
        : playingDate
          ? (Date.now() + clockOffsetRef.current - playingDate.getTime()) / 1_000
          : liveEdge === null
            ? null
            : liveEdge - video.currentTime;
      const quality = video.getVideoPlaybackQuality?.();

      setStats({
        bandwidth: hls?.bandwidthEstimate ?? null,
        mediaBitrate: hls ? hls.levels[hls.currentLevel]?.realBitrate || null : null,
        bufferAhead,
        bufferTotal,
        delay,
        droppedFrames: quality?.droppedVideoFrames ?? 0,
        playtime: video.currentTime,
        rate: video.playbackRate,
        resolution:
          video.videoWidth && video.videoHeight
            ? `${video.videoWidth} × ${video.videoHeight}`
            : "--",
        seekableWindow:
          video.seekable.length > 0
            ? video.seekable.end(video.seekable.length - 1) - video.seekable.start(0)
            : 0,
      });
    }

    updateStats();
    const timer = setInterval(updateStats, 1_000);
    return () => clearInterval(timer);
  }, [showStats, videoRef, hlsRef, clockOffsetRef]);

  return stats;
}
