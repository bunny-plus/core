import { useEffect, useState } from "react";

import { AssetIcon, UiIcon } from "./Icons";
import MovieDiscover from "./MovieDiscover";
import RestreamControl from "./RestreamControl";
import { apiJson } from "./api";

type TorBoxFile = {
  id: number;
  infected: boolean;
  mimetype: string;
  name: string;
  short_name: string;
  size: number;
  zipped: boolean;
};

type TorBoxTorrent = {
  download_finished: boolean;
  download_present: boolean;
  files: TorBoxFile[];
  id: number;
  name: string;
  progress: number;
  size: number;
};

type ControllerStatus = {
  running: boolean;
  title: string | null;
};

type MediaTrack = {
  channels: number | null;
  codec: string | null;
  default: boolean;
  index: number;
  language: string | null;
  title: string | null;
};

type MediaOptions = {
  audio: MediaTrack[];
  sourceResolution: number | null;
  subtitles: MediaTrack[];
};

const resolutions = ["144p", "240p", "360p", "480p", "720p", "1080p", "1440p", "2160p"];

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "--";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1_024)), units.length - 1);
  return `${(bytes / 1_024 ** unit).toFixed(unit > 2 ? 1 : 0)} ${units[unit]}`;
}

function isVideo(file: TorBoxFile) {
  return (
    !file.infected &&
    !file.zipped &&
    (file.mimetype?.startsWith("video/") || /\.(mkv|mp4|m4v|mov|avi|webm|ts)$/i.test(file.name))
  );
}

function trackLabel(track: MediaTrack, fallback: string) {
  const name = track.title || track.language || fallback;
  const details = [track.codec, track.channels ? `${track.channels}ch` : null]
    .filter(Boolean)
    .join(" · ");
  return `${name}${details ? ` (${details})` : ""}${track.default ? " · default" : ""}`;
}

export default function StreamControl() {
  const [source, setSource] = useState<"discover" | "jellyfin" | "restream" | "torbox">("torbox");
  const [torrents, setTorrents] = useState<TorBoxTorrent[]>([]);
  const [status, setStatus] = useState<ControllerStatus | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ file: TorBoxFile; torrent: TorBoxTorrent } | null>(
    null,
  );
  const [options, setOptions] = useState<MediaOptions | null>(null);
  const [audioIndex, setAudioIndex] = useState(0);
  const [subtitleIndex, setSubtitleIndex] = useState(-1);
  const [resolutionIndex, setResolutionIndex] = useState(-1);

  async function loadTorrents(refresh = false) {
    const result = await apiJson<{ torrents: TorBoxTorrent[] }>(
      `/api/admin/torbox/torrents${refresh ? "?refresh=1" : ""}`,
    );
    setTorrents(result.torrents);
  }

  useEffect(() => {
    Promise.allSettled([
      apiJson<{ torrents: TorBoxTorrent[] }>("/api/admin/torbox/torrents?refresh=1"),
      apiJson<ControllerStatus>("/api/admin/torbox/status"),
    ])
      .then(([list, controllerStatus]) => {
        if (list.status === "fulfilled") setTorrents(list.value.torrents);
        else
          setMessage(list.reason instanceof Error ? list.reason.message : "Could not load TorBox");
        if (controllerStatus.status === "fulfilled") setStatus(controllerStatus.value);
      })
      .finally(() => setLoading(false));
  }, []);

  const playableTorrents = torrents
    .map((torrent) => ({ torrent, videos: torrent.files.filter(isVideo) }))
    .filter(({ torrent, videos }) => {
      const needle = query.toLowerCase();
      return (
        videos.length > 0 &&
        (!needle ||
          torrent.name.toLowerCase().includes(needle) ||
          videos.some((file) => file.name.toLowerCase().includes(needle)))
      );
    });

  async function configure(torrent: TorBoxTorrent, file: TorBoxFile) {
    const key = `options:${torrent.id}:${file.id}`;
    setSelected({ file, torrent });
    setOptions(null);
    setBusy(key);
    setMessage(null);
    try {
      const result = await apiJson<MediaOptions>("/api/admin/torbox/options", {
        body: JSON.stringify({ fileId: file.id, torrentId: torrent.id }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      setOptions(result);
      setAudioIndex(
        result.audio.find((track) => track.default)?.index ?? result.audio[0]?.index ?? 0,
      );
      setSubtitleIndex(-1);
      setResolutionIndex(result.sourceResolution && result.sourceResolution > 1_080 ? 5 : -1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not inspect media tracks");
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    if (!selected) return;
    setBusy("start");
    setMessage(null);
    try {
      const result = await apiJson<{ detail: string }>("/api/admin/torbox/start", {
        body: JSON.stringify({
          audioIndex,
          fileId: selected.file.id,
          resolutionIndex: resolutionIndex < 0 ? null : resolutionIndex,
          subtitleIndex: subtitleIndex < 0 ? null : subtitleIndex,
          title: selected.file.short_name || selected.file.name,
          torrentId: selected.torrent.id,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      setStatus({ running: true, title: selected.file.short_name || selected.file.name });
      setMessage(result.detail);
      setSelected(null);
      setOptions(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start stream");
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    setBusy("stop");
    setMessage(null);
    try {
      await apiJson("/api/admin/torbox/stop", { method: "POST" });
      setStatus({ running: false, title: null });
      setMessage("Stream stopped");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not stop stream");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="stream-modal admin-stream-panel" aria-labelledby="stream-control-title">
      <header>
        <div>
          <AssetIcon name="carrot" />
          <div>
            <h2 id="stream-control-title">Choose a stream source</h2>
            <p>Pick what everyone watches next.</p>
          </div>
        </div>
      </header>

      {status?.running && (
        <div className="current-stream">
          <div>
            <i />
            <span>Now relaying</span>
            <strong>{status.title || "TorBox stream"}</strong>
          </div>
          <button type="button" disabled={busy !== null} onClick={() => void stop()}>
            {busy === "stop" ? "Stopping..." : "Stop"}
          </button>
        </div>
      )}

      <div className="source-picker" role="group" aria-label="Stream source">
        <button
          className={source === "torbox" ? "active" : ""}
          type="button"
          aria-pressed={source === "torbox"}
          onClick={() => setSource("torbox")}
        >
          <UiIcon name="disc" />
          <span>
            <strong>TorBox</strong>
            <small>Your downloads</small>
          </span>
        </button>
        <button
          className={source === "discover" ? "active" : ""}
          type="button"
          aria-pressed={source === "discover"}
          onClick={() => setSource("discover")}
        >
          <UiIcon name="film" />
          <span>
            <strong>Discover</strong>
            <small>Movies + cached releases</small>
          </span>
        </button>
        <button
          className={source === "restream" ? "active" : ""}
          type="button"
          aria-pressed={source === "restream"}
          onClick={() => setSource("restream")}
        >
          <UiIcon name="broadcast" />
          <span>
            <strong>Restream</strong>
            <small>YouTube + Twitch</small>
          </span>
        </button>
        <button
          className={source === "jellyfin" ? "active" : ""}
          type="button"
          aria-pressed={source === "jellyfin"}
          onClick={() => setSource("jellyfin")}
        >
          <UiIcon name="server" />
          <span>
            <strong>Jellyfin</strong>
            <small>Coming soon</small>
          </span>
        </button>
      </div>

      {message && <p className="stream-message">{message}</p>}

      {source === "torbox" && (
        <>
          <label className="stream-search-label" htmlFor="torrent-search">
            Search torrents and playable files
          </label>
          <input
            id="torrent-search"
            className="stream-search"
            type="search"
            value={query}
            placeholder="Name..."
            onChange={(event) => setQuery(event.target.value)}
          />
          {selected && (
            <div className="stream-options">
              <header>
                <div>
                  <small>SETTING UP</small>
                  <strong>{selected.file.short_name || selected.file.name}</strong>
                </div>
                <button
                  type="button"
                  aria-label="Close media options"
                  onClick={() => {
                    setSelected(null);
                    setOptions(null);
                  }}
                >
                  ×
                </button>
              </header>
              {!options ? (
                <p>
                  <UiIcon name="disc" /> Reading audio and subtitle tracks...
                </p>
              ) : (
                <>
                  <div className="track-selectors">
                    <label>
                      <span>Audio</span>
                      <select
                        value={audioIndex}
                        onChange={(event) => setAudioIndex(Number(event.target.value))}
                      >
                        {options.audio.length === 0 && <option value="0">Default audio</option>}
                        {options.audio.map((track) => (
                          <option value={track.index} key={track.index}>
                            {trackLabel(track, `Track ${track.index + 1}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Subtitles</span>
                      <select
                        value={subtitleIndex}
                        onChange={(event) => setSubtitleIndex(Number(event.target.value))}
                      >
                        <option value="-1">None</option>
                        {options.subtitles.map((track) => (
                          <option value={track.index} key={track.index}>
                            {trackLabel(track, `Subtitle ${track.index + 1}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Resolution</span>
                      <select
                        value={resolutionIndex}
                        onChange={(event) => setResolutionIndex(Number(event.target.value))}
                      >
                        <option value="-1">
                          Original
                          {options.sourceResolution ? ` (${options.sourceResolution}p)` : ""}
                        </option>
                        {resolutions.map((resolution, index) => (
                          <option value={index} key={resolution}>
                            {resolution}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    className="start-relay"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void start()}
                  >
                    {busy === "start" ? "Starting relay..." : "Stream this file"}
                  </button>
                </>
              )}
            </div>
          )}

          <div className="torrent-list">
            {loading && (
              <p className="torrent-empty">
                <AssetIcon name="bunny-face" /> Digging through TorBox...
              </p>
            )}
            {!loading && playableTorrents.length === 0 && (
              <p className="torrent-empty">No playable video files match this search.</p>
            )}
            {playableTorrents.map(({ torrent, videos }) => {
              return (
                <details className="torrent" key={torrent.id}>
                  <summary>
                    <UiIcon name="film" />
                    <div>
                      <strong>{torrent.name}</strong>
                      <small>
                        {videos.length} video{videos.length === 1 ? "" : "s"} ·{" "}
                        {formatBytes(torrent.size)}
                      </small>
                    </div>
                    <i>{torrent.download_present ? "ready" : `${Math.round(torrent.progress)}%`}</i>
                  </summary>
                  <div className="torrent-files">
                    {videos.map((file) => {
                      const key = `options:${torrent.id}:${file.id}`;
                      return (
                        <div className="torrent-file" key={file.id}>
                          <div>
                            <strong>{file.short_name || file.name}</strong>
                            <small>{formatBytes(file.size)}</small>
                          </div>
                          <button
                            type="button"
                            disabled={!torrent.download_present || busy !== null}
                            onClick={() => void configure(torrent, file)}
                          >
                            {busy === key ? "Reading..." : "Set up"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        </>
      )}
      {source === "discover" && (
        <MovieDiscover
          onAdded={async (detail) => {
            setMessage(`${detail}. Pick it from TorBox to choose the file and tracks.`);
            setSource("torbox");
            setLoading(true);
            try {
              await loadTorrents(true);
            } catch {
              setMessage(
                `${detail}. TorBox may need a moment before the movie appears; refresh the page if needed.`,
              );
            } finally {
              setLoading(false);
            }
          }}
        />
      )}
      {source === "restream" && (
        <RestreamControl
          onStarted={(title) => {
            setStatus({ running: true, title });
            setMessage(null);
          }}
        />
      )}
      {source === "jellyfin" && (
        <div className="source-coming-soon">
          <UiIcon name="server" />
          <strong>Jellyfin is still wiring up</strong>
          <p>The button has its seat saved. Library browsing and playback come later.</p>
        </div>
      )}
    </section>
  );
}
