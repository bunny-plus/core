import type { PlayerStats } from "./usePlaybackStats";
import { formatTime } from "./playback";

function bitrate(value: number | null) {
  return value === null ? "--" : `${(value / 1_000_000).toFixed(2)} Mbps`;
}

export default function PlaybackStats({ stats }: { stats: PlayerStats }) {
  const values = [
    { label: "Behind live", value: stats.latency === null ? "--" : `${stats.latency.toFixed(1)}s` },
    { label: "Buffered", value: `${stats.buffer.toFixed(1)}s` },
    { label: "Playtime", value: formatTime(stats.playtime) },
    { label: "Resolution", value: stats.resolution },
    {
      label: "Media bitrate",
      value: bitrate(stats.bitrate),
      hint: "Bitrate of the selected video quality",
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
