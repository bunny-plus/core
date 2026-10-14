import type { PlayerStats } from "./usePlaybackStats";
import { formatTime } from "./playback";

function bitrate(value: number | null) {
  return value === null ? "--" : `${(value / 1_000_000).toFixed(2)} Mbps`;
}

export default function PlaybackStats({ stats, target }: { stats: PlayerStats; target: string }) {
  const values = [
    { label: "Delay", value: stats.delay === null ? "--" : `${stats.delay.toFixed(1)}s` },
    { label: "Target", value: target },
    { label: "Buffered ahead", value: `${stats.bufferAhead.toFixed(1)}s` },
    { label: "Total buffered", value: `${stats.bufferTotal.toFixed(1)}s` },
    { label: "Live window", value: `${stats.seekableWindow.toFixed(1)}s` },
    { label: "Playtime", value: formatTime(stats.playtime) },
    { label: "Playback rate", value: `${stats.rate.toFixed(3)}×` },
    { label: "Resolution", value: stats.resolution },
    {
      label: "Download speed (est.)",
      value: bitrate(stats.bandwidth),
      hint: "Estimated speed while downloading segments, not the video bitrate",
    },
    {
      label: "Media bitrate",
      value: bitrate(stats.mediaBitrate),
      hint: "Average bitrate of the downloaded media segments",
    },
    { label: "Dropped frames", value: stats.droppedFrames },
  ];
  return (
    <div className="player-stats" role="group" aria-label="Playback statistics">
      {values.map(({ label, value, hint }) => (
        <div key={label}>
          <span title={hint}>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
