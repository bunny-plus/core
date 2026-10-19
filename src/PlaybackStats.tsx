import type { PlayerStats } from "./usePlaybackStats";
import { formatTime } from "./playback";

function milliseconds(value: number | null) {
  return value === null ? "--" : `${Math.round(value)} ms`;
}

export default function PlaybackStats({ stats }: { stats: PlayerStats }) {
  const range = Math.max(
    250,
    Math.ceil(Math.max(stats.buffer ?? 0, stats.targetBuffer ?? 0) / 250) * 250,
  );
  const position = (value: number) => (Math.min(range, Math.max(0, value)) / range) * 100;
  const values = [
    { label: "Decoded FPS", value: stats.fps?.toFixed(1) ?? "--" },
    { label: "Playtime", value: formatTime(stats.playtime) },
    { label: "Resolution", value: stats.resolution },
    {
      label: "Video bitrate",
      value: stats.bitrate === null ? "--" : `${(stats.bitrate / 1_000_000).toFixed(2)} Mbps`,
    },
    { label: "Dropped frames", value: stats.droppedFrames ?? "--" },
    { label: "Video jitter", value: milliseconds(stats.jitter) },
    { label: "Packets lost", value: stats.packetsLost ?? "--" },
    { label: "Freezes", value: stats.freezes ?? "--" },
  ];
  return (
    <div className="player-stats" role="group" aria-label="Playback statistics">
      {stats.buffer !== null && (
        <div className="player-live-position">
          <div className="player-live-heading">
            <span>Playback buffer</span>
            <strong>{milliseconds(stats.buffer)}</strong>
          </div>
          <div
            className="player-live-track"
            role="meter"
            aria-label="Video receiver buffer delay"
            aria-valuemin={0}
            aria-valuemax={range}
            aria-valuenow={Math.max(0, stats.buffer)}
            aria-valuetext={`${Math.round(stats.buffer)} milliseconds of receiver buffering`}
          >
            <div
              className="player-live-buffer"
              style={{ left: 0, width: `${position(stats.buffer)}%` }}
            />
            {stats.targetBuffer !== null && (
              <div
                className="player-live-target"
                style={{ left: `${position(stats.targetBuffer)}%` }}
                title={`Browser target: ${milliseconds(stats.targetBuffer)}`}
              />
            )}
            <div className="player-live-thumb" style={{ left: `${position(stats.buffer)}%` }} />
          </div>
          <div className="player-live-scale" aria-hidden="true">
            <span>0 ms</span>
            <span>{range} ms</span>
          </div>
          <p>
            Receiver buffering{stats.targetBuffer !== null && " · Mark: browser target"}. Total live
            delay is unavailable.
          </p>
        </div>
      )}
      {values.map(({ label, value }) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
