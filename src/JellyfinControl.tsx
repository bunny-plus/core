import { useEffect, useRef, useState } from "react";

import type {
  JellyfinItem,
  JellyfinLibrary,
  JellyfinOptions,
  JellyfinSource,
} from "../shared/jellyfin";
import { AssetIcon, UiIcon } from "./Icons";
import { apiJson } from "./api";

const resolutions = [144, 240, 360, 480, 720, 1080, 1440, 2160];

export default function JellyfinControl({
  onStarted,
  onBusyChange,
}: {
  onStarted: (title: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [trail, setTrail] = useState<JellyfinItem[]>([]);
  const [startIndex, setStartIndex] = useState(0);
  const [reload, setReload] = useState(0);
  const [library, setLibrary] = useState<JellyfinLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [options, setOptions] = useState<JellyfinOptions | null>(null);
  const [mediaSourceId, setMediaSourceId] = useState("");
  const [audioIndex, setAudioIndex] = useState<number | null>(null);
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null);
  const [resolutionIndex, setResolutionIndex] = useState<number | null>(null);
  const selectionRequest = useRef(0);
  const parentId = trail.at(-1)?.id;
  const source = options?.sources.find((entry) => entry.id === mediaSourceId);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ query, startIndex: String(startIndex) });
      if (parentId) params.set("parentId", parentId);
      void apiJson<JellyfinLibrary>(`/api/admin/jellyfin/items?${params}`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted) setLibrary(result);
        })
        .catch((reason: Error) => {
          if (!controller.signal.aborted) {
            setLibrary(null);
            setError(reason.message || "Could not load Jellyfin");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, parentId, startIndex, reload]);

  useEffect(
    () => () => {
      selectionRequest.current += 1;
    },
    [],
  );

  function chooseSource(next: JellyfinSource) {
    setMediaSourceId(next.id);
    setAudioIndex(next.defaultAudioIndex);
    setSubtitleIndex(next.defaultSubtitleIndex);
    setResolutionIndex(next.height && next.height > 1440 ? 6 : null);
  }

  function closeOptions() {
    selectionRequest.current += 1;
    setOptions(null);
    setReading(null);
  }

  function navigate(nextTrail: JellyfinItem[]) {
    closeOptions();
    setTrail(nextTrail);
    setQuery("");
    setStartIndex(0);
  }

  async function select(item: JellyfinItem) {
    if (item.kind === "Series" || item.kind === "Season") {
      navigate([...trail, item]);
      return;
    }
    const requestId = ++selectionRequest.current;
    setReading(item.id);
    setOptions(null);
    setError(null);
    setMessage(null);
    try {
      const result = await apiJson<JellyfinOptions>("/api/admin/jellyfin/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id }),
      });
      if (selectionRequest.current !== requestId) return;
      setOptions(result);
      chooseSource(result.sources[0]);
    } catch (reason) {
      if (selectionRequest.current === requestId)
        setError(reason instanceof Error ? reason.message : "Could not read this item");
    } finally {
      if (selectionRequest.current === requestId) setReading(null);
    }
  }

  async function start() {
    if (!options || !source) return;
    setStarting(true);
    onBusyChange(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiJson<{ title: string; detail: string }>("/api/admin/jellyfin/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: options.item.id,
          mediaSourceId,
          audioIndex,
          subtitleIndex,
          resolutionIndex,
        }),
      });
      onStarted(result.title);
      setMessage(result.detail);
      closeOptions();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start Jellyfin");
    } finally {
      setStarting(false);
      onBusyChange(false);
    }
  }

  return (
    <div className="jellyfin-panel">
      {trail.length > 0 && (
        <nav className="jellyfin-breadcrumbs" aria-label="Jellyfin library location">
          <button type="button" disabled={starting} onClick={() => navigate([])}>
            Library
          </button>
          {trail.map((item, index) => (
            <button
              type="button"
              key={item.id}
              disabled={starting}
              aria-current={index === trail.length - 1 ? "page" : undefined}
              onClick={() => navigate(trail.slice(0, index + 1))}
            >
              {item.name}
            </button>
          ))}
        </nav>
      )}
      <label className="stream-search-label" htmlFor="jellyfin-search">
        {parentId ? "Search in this show" : "Search movies and shows"}
      </label>
      <input
        className="stream-search"
        id="jellyfin-search"
        type="search"
        value={query}
        disabled={starting}
        placeholder="Find something to watch…"
        onChange={(event) => {
          setQuery(event.target.value);
          setStartIndex(0);
        }}
      />
      {error && (
        <div className="stream-message" role="alert">
          {error}{" "}
          <button type="button" disabled={starting} onClick={() => setReload((value) => value + 1)}>
            Reload library
          </button>
        </div>
      )}
      {message && (
        <p className="stream-message" role="status">
          {message}
        </p>
      )}
      {reading && (
        <p className="torrent-empty" role="status">
          Reading media versions, audio, and subtitles…
        </p>
      )}
      {options && source && (
        <div className="stream-options">
          <header>
            <div>
              <strong>{options.item.title}</strong>
            </div>
            <button
              type="button"
              aria-label="Close Jellyfin media options"
              disabled={starting}
              onClick={closeOptions}
            >
              ×
            </button>
          </header>
          <div className="track-selectors">
            <label>
              <span>Version</span>
              <select
                value={mediaSourceId}
                disabled={starting}
                onChange={(event) => {
                  const next = options.sources.find((entry) => entry.id === event.target.value);
                  if (next) chooseSource(next);
                }}
              >
                {options.sources.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Audio</span>
              <select
                value={audioIndex ?? ""}
                disabled={starting || !source.audio.length}
                onChange={(event) => setAudioIndex(Number(event.target.value))}
              >
                {!source.audio.length && <option value="">No audio</option>}
                {source.audio.map((track) => (
                  <option key={track.index} value={track.index}>
                    {track.label}
                    {track.default ? " · default" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Subtitles</span>
              <select
                value={subtitleIndex ?? ""}
                disabled={starting || !source.subtitles.some((track) => track.supported)}
                onChange={(event) =>
                  setSubtitleIndex(event.target.value === "" ? null : Number(event.target.value))
                }
              >
                <option value="">None</option>
                {source.subtitles.map((track) => (
                  <option key={track.index} value={track.index} disabled={!track.supported}>
                    {track.label}
                    {track.supported ? "" : " (unsupported format)"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Resolution</span>
              <select
                value={resolutionIndex ?? ""}
                disabled={starting}
                onChange={(event) =>
                  setResolutionIndex(event.target.value === "" ? null : Number(event.target.value))
                }
              >
                <option value="">Original{source.height ? ` (${source.height}p)` : ""}</option>
                {resolutions.map((height, index) => (
                  <option key={height} value={index}>
                    {height}p
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p>The selected subtitles are on by default. Viewers can turn them off with CC.</p>
          <button
            className="start-relay"
            type="button"
            disabled={starting}
            onClick={() => void start()}
          >
            {starting ? "Starting Jellyfin…" : "Stream for everyone"}
          </button>
        </div>
      )}
      <div className="jellyfin-list" aria-busy={loading}>
        {loading ? (
          <p className="torrent-empty" role="status">
            <AssetIcon name="bunny-face" /> Browsing Jellyfin…
          </p>
        ) : library?.items.length === 0 ? (
          <p className="torrent-empty">
            {query
              ? "No movies or episodes match this search."
              : "No movies or shows are available here."}
          </p>
        ) : (
          !error &&
          library?.items.map((item) => (
            <button
              className="jellyfin-item"
              type="button"
              key={item.id}
              disabled={starting || reading !== null}
              onClick={() => void select(item)}
            >
              <UiIcon name={item.kind === "Series" || item.kind === "Season" ? "server" : "film"} />
              <span>
                <strong>{item.title}</strong>
                <small>
                  {[item.kind, item.year, item.minutes ? `${item.minutes} min` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
              <span className="jellyfin-item-action">
                {item.kind === "Series" || item.kind === "Season" ? "Browse" : "Set up"}
              </span>
            </button>
          ))
        )}
      </div>
      {!loading && library && library.total > library.limit && (
        <div className="jellyfin-pages">
          <button
            type="button"
            disabled={starting || startIndex === 0}
            onClick={() => setStartIndex(Math.max(0, startIndex - library.limit))}
          >
            Previous
          </button>
          <span>
            {startIndex + 1}–{Math.min(startIndex + library.items.length, library.total)} of{" "}
            {library.total}
          </span>
          <button
            type="button"
            disabled={starting || startIndex + library.limit >= library.total}
            onClick={() => setStartIndex(startIndex + library.limit)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
