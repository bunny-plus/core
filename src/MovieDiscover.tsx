import { useEffect, useRef, useState } from "react";

import { AssetIcon, UiIcon } from "./Icons";
import { apiFetch } from "./api";

type Movie = {
  backdrop: string | null;
  id: number;
  overview: string;
  poster: string | null;
  releaseDate: string;
  title: string;
  voteAverage: number;
};

type Release = {
  cached: boolean;
  fileIndex: number | null;
  hash: string;
  label: string;
  trackers: string[];
};

async function api<T>(url: string, init?: RequestInit) {
  const response = await apiFetch(url, init);
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}

export default function MovieDiscover({ onAdded }: { onAdded: (detail: string) => Promise<void> }) {
  const movieRequestRef = useRef<AbortController>(null);
  const releaseRequestRef = useRef<AbortController>(null);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [selected, setSelected] = useState<Movie | null>(null);
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadMovies(search = "") {
    movieRequestRef.current?.abort();
    const request = new AbortController();
    movieRequestRef.current = request;
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ movies: Movie[] }>(
        `/api/admin/movies${search ? `?q=${encodeURIComponent(search)}` : ""}`,
        { signal: request.signal },
      );
      if (movieRequestRef.current !== request) return;
      setMovies(result.movies);
    } catch (loadError) {
      if (request.signal.aborted) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load movies");
    } finally {
      if (movieRequestRef.current === request) setLoading(false);
    }
  }

  useEffect(() => {
    const request = new AbortController();
    movieRequestRef.current = request;
    api<{ movies: Movie[] }>("/api/admin/movies", { signal: request.signal })
      .then((result) => {
        if (movieRequestRef.current === request) setMovies(result.movies);
      })
      .catch((loadError: unknown) => {
        if (!request.signal.aborted)
          setError(loadError instanceof Error ? loadError.message : "Could not load movies");
      })
      .finally(() => {
        if (movieRequestRef.current === request) setLoading(false);
      });
    return () => {
      request.abort();
      releaseRequestRef.current?.abort();
    };
  }, []);

  async function openMovie(movie: Movie) {
    releaseRequestRef.current?.abort();
    const request = new AbortController();
    releaseRequestRef.current = request;
    setSelected(movie);
    setReleases(null);
    setError(null);
    try {
      const result = await api<{ releases: Release[] }>(`/api/admin/movies/${movie.id}/releases`, {
        signal: request.signal,
      });
      if (releaseRequestRef.current !== request) return;
      setReleases(result.releases);
    } catch (loadError) {
      if (request.signal.aborted) return;
      setError(loadError instanceof Error ? loadError.message : "Could not find releases");
      setReleases([]);
    }
  }

  async function addRelease(release: Release) {
    if (!selected) return;
    setBusy(release.hash);
    setError(null);
    try {
      const result = await api<{ detail: string }>("/api/admin/movies/add", {
        body: JSON.stringify({
          hash: release.hash,
          title: selected.title,
          trackers: release.trackers,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      await onAdded(result.detail);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not add release");
    } finally {
      setBusy(null);
    }
  }

  if (selected) {
    return (
      <div className="movie-detail">
        <button
          className="movie-back"
          type="button"
          onClick={() => {
            releaseRequestRef.current?.abort();
            setSelected(null);
            setReleases(null);
            setError(null);
          }}
        >
          ← Back to movies
        </button>
        <div
          className="movie-detail-hero"
          style={
            selected.backdrop
              ? {
                  backgroundImage: `linear-gradient(90deg, rgba(41,35,44,.96), rgba(41,35,44,.45)), url(${selected.backdrop})`,
                }
              : undefined
          }
        >
          <div>
            <small>
              {selected.releaseDate?.slice(0, 4) || "MOVIE"} ·{" "}
              {selected.voteAverage ? `${selected.voteAverage.toFixed(1)}/10` : "UNRATED"}
            </small>
            <h3>{selected.title}</h3>
            <p>{selected.overview || "No synopsis is available for this movie."}</p>
          </div>
        </div>
        {error && <p className="stream-message">{error}</p>}
        {releases === null && (
          <p className="torrent-empty">
            <AssetIcon name="bunny-face" /> Looking for cached releases...
          </p>
        )}
        {releases?.length === 0 && (
          <p className="torrent-empty">No torrent releases were returned for this movie.</p>
        )}
        {releases && releases.length > 0 && (
          <div className="movie-releases">
            <div className="release-heading">
              <strong>Pick a release</strong>
              <small>Cached releases play immediately</small>
            </div>
            {releases.map((release) => (
              <div className="movie-release" key={`${release.hash}:${release.fileIndex ?? ""}`}>
                <span className={release.cached ? "cached" : "uncached"}>
                  {release.cached ? "CACHED" : "DOWNLOAD"}
                </span>
                <p>{release.label}</p>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void addRelease(release)}
                >
                  {busy === release.hash ? "Adding..." : "Add to TorBox"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="movie-discover">
      <form
        className="movie-search"
        onSubmit={(event) => {
          event.preventDefault();
          void loadMovies(query.trim());
        }}
      >
        <label htmlFor="movie-search">Search movies</label>
        <div>
          <input
            id="movie-search"
            type="search"
            value={query}
            placeholder="Title..."
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit">Search</button>
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                void loadMovies();
              }}
            >
              Trending
            </button>
          )}
        </div>
      </form>
      {error && <p className="stream-message">{error}</p>}
      {loading && (
        <p className="torrent-empty">
          <AssetIcon name="bunny-face" /> Fetching the marquee...
        </p>
      )}
      {!loading && movies.length === 0 && <p className="torrent-empty">No movies found.</p>}
      <div className="movie-grid">
        {movies.map((movie, index) => (
          <button
            className="movie-card"
            type="button"
            key={movie.id}
            onClick={() => void openMovie(movie)}
          >
            {movie.poster ? (
              <img
                src={movie.poster.replace("/w500/", "/w185/")}
                srcSet={`${movie.poster.replace("/w500/", "/w185/")} 185w, ${movie.poster.replace("/w500/", "/w342/")} 342w`}
                sizes="(max-width: 600px) calc(50vw - 38px), 156px"
                alt=""
                decoding="async"
                loading={index < 8 ? "eager" : "lazy"}
              />
            ) : (
              <span className="movie-poster-empty">
                <UiIcon name="film" />
              </span>
            )}
            <span>
              <strong>{movie.title}</strong>
              <small>{movie.releaseDate?.slice(0, 4) || "Coming soon"}</small>
            </span>
          </button>
        ))}
      </div>
      <small className="movie-attribution">Movie metadata and artwork provided by TMDB.</small>
    </div>
  );
}
