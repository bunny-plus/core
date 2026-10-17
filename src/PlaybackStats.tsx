import type { PlayerStats } from "./usePlaybackStats";
import { formatTime } from "./playback";

function bitrate(value: number | null) {
  return value === null ? "--" : `${(value / 1_000_000).toFixed(2)} Mbps`;
}

export default function PlaybackStats({ stats }: { stats: PlayerStats }) {
  const range = Math.max(15, stats.targetLatency ?? 0);
  const position = (seconds: number) => (1 - Math.min(range, Math.max(0, seconds)) / range) * 100;
  const playhead = position(stats.latency ?? 0);
  const bufferedEnd = position((stats.latency ?? 0) - stats.buffer);
  const values = [
    { label: "Buffered ahead", value: `${stats.buffer.toFixed(1)}s` },
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
      {stats.latency !== null && (
        <div className="player-live-position">
          <div className="player-live-heading">
            <span>Behind live</span>
            <strong>{stats.latency.toFixed(1)}s</strong>
          </div>
          <div
            className="player-live-track"
            role="meter"
            aria-label="Playback position behind live"
            aria-valuemin={-range}
            aria-valuemax={0}
            aria-valuenow={-Math.min(range, stats.latency)}
            aria-valuetext={`${stats.latency.toFixed(1)} seconds behind live; ${stats.buffer.toFixed(1)} seconds buffered ahead`}
          >
            <div
              className="player-live-buffer"
              style={{ left: `${playhead}%`, width: `${bufferedEnd - playhead}%` }}
            />
            {stats.targetLatency !== null && (
              <div
                className="player-live-target"
                style={{ left: `${position(stats.targetLatency)}%` }}
                title={`Target: ${stats.targetLatency.toFixed(1)}s behind live`}
              />
            )}
            <div className="player-live-thumb" style={{ left: `${playhead}%` }} />
          </div>
          <div className="player-live-scale" aria-hidden="true">
            <span>{range}s+</span>
            <span>Live edge</span>
          </div>
          <p>
            Dot: you · Pink: buffered ahead
            {stats.targetLatency !== null && " · Mark: target"}
          </p>
        </div>
      )}
      {values.map(({ label, value, hint }) => (
        <div key={label}>
          <span title={hint}>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
