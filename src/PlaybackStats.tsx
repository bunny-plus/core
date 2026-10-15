import type { PlayerStats } from "./usePlaybackStats";
import { formatTime } from "./playback";

function bitrate(value: number | null) {
  return value === null ? "--" : `${(value / 1_000_000).toFixed(2)} Mbps`;
}

export default function PlaybackStats({ stats, target }: { stats: PlayerStats; target: string }) {
  const values = [
    { label: "Target", value: target },
    {
      label: "Network round trip",
      value: stats.roundTrip === null ? "--" : `${Math.round(stats.roundTrip * 1000)}ms`,
    },
    {
      label: "Jitter",
      value: stats.jitter === null ? "--" : `${Math.round(stats.jitter * 1000)}ms`,
    },
    { label: "Packets lost", value: stats.packetsLost ?? "--" },
    { label: "Playtime", value: formatTime(stats.playtime) },
    { label: "Resolution", value: stats.resolution },
    {
      label: "Media bitrate",
      value: bitrate(stats.bitrate),
      hint: "Video received over the last stats interval",
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
