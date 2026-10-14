import type { Env, RequestMetadata } from "./env";
import { authorizeCostly } from "./authentication";
import { apiError, jsonObject } from "./http";
import { torBox, type TorBoxResponse } from "./torbox";
import { TtlCache } from "../server/cache";
import { fetchJson } from "../server/upstream";
import { isJsonObject, isString, isStringList, isInteger, type JsonValue } from "../shared/json";

type TmdbMovie = {
  adult?: boolean;
  backdrop_path: string | null;
  id: number;
  overview: string;
  poster_path: string | null;
  release_date: string;
  title: string;
  vote_average: number;
};

type StremioStream = {
  fileIdx?: number;
  infoHash?: string;
  name?: string;
  sources?: string[];
  title?: string;
};

function isTmdbMovie(movie: JsonValue): movie is TmdbMovie {
  if (!isJsonObject(movie)) return false;
  return (
    Number.isInteger(movie.id) &&
    isString(movie.title) &&
    isString(movie.overview) &&
    isString(movie.release_date) &&
    typeof movie.vote_average === "number" &&
    (movie.backdrop_path === null || isString(movie.backdrop_path)) &&
    (movie.poster_path === null || isString(movie.poster_path))
  );
}

function isStremioStream(stream: JsonValue): stream is StremioStream {
  if (!isJsonObject(stream)) return false;
  return (
    (stream.fileIdx === undefined || isInteger(stream.fileIdx)) &&
    (stream.infoHash === undefined || isString(stream.infoHash)) &&
    (stream.name === undefined || isString(stream.name)) &&
    (stream.sources === undefined || isStringList(stream.sources)) &&
    (stream.title === undefined || isString(stream.title))
  );
}

const cache = new TtlCache(500);

async function tmdb<T>(path: string, env: Env) {
  if (!env.TMDB_API_TOKEN) throw new Error("TMDB_API_TOKEN is not configured");
  const { data } = await fetchJson<T>(`https://api.themoviedb.org/3${path}`, {
    headers: { Authorization: `Bearer ${env.TMDB_API_TOKEN}` },
    name: "TMDB",
    timeoutMs: 10000,
  });
  return data;
}

function cleanMovie(movie: TmdbMovie) {
  return {
    backdrop: movie.backdrop_path ? `https://image.tmdb.org/t/p/w780${movie.backdrop_path}` : null,
    id: movie.id,
    overview: movie.overview,
    poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
    releaseDate: movie.release_date,
    title: movie.title,
    voteAverage: movie.vote_average,
  };
}

function addonBase(env: Env) {
  if (!env.STREMIO_ADDON_URL) throw new Error("STREMIO_ADDON_URL is not configured");
  const url = new URL(env.STREMIO_ADDON_URL);
  if (url.protocol !== "https:") throw new Error("STREMIO_ADDON_URL must use HTTPS");
  url.pathname = url.pathname.replace(/\/manifest\.json\/?$/, "").replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

function torrentCached(data: JsonValue, hash: string) {
  if (!data) return false;
  if (Array.isArray(data))
    return data.some(
      (entry) => isJsonObject(entry) && String(entry.hash ?? "").toLowerCase() === hash,
    );
  if (!isJsonObject(data)) return false;
  const match = data[hash] ?? data[hash.toLowerCase()] ?? data[hash.toUpperCase()];
  return match === undefined ? String(data.hash ?? "").toLowerCase() === hash : Boolean(match);
}

function releaseScore(label: string) {
  const normalized = label.toLowerCase();
  if (/2160p|4k/.test(normalized)) return 4;
  if (/1080p/.test(normalized)) return 3;
  if (/720p/.test(normalized)) return 2;
  return 1;
}

export async function movieRoutes(
  request: Request,
  env: Env,
  url: URL,
  metadata?: RequestMetadata,
) {
  if (url.pathname === "/api/admin/movies" && request.method === "GET") {
    const authorization = await authorizeCostly(
      request,
      env,
      metadata,
      "discovery",
      30,
      "stream.manage",
    );
    if (authorization instanceof Response) return authorization;
    try {
      const query = url.searchParams.get("q")?.trim().slice(0, 100) ?? "";
      const cacheKey = query
        ? `tmdb/search/${encodeURIComponent(query.toLowerCase())}`
        : "tmdb/trending/week";
      const maxAge = query ? 6 * 60 * 60 : 24 * 60 * 60;
      const result = await cache.getOrLoad(cacheKey, maxAge, () =>
        tmdb<{
          results: JsonValue[];
        }>(
          query
            ? `/search/movie?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`
            : "/trending/movie/week?language=en-US",
          env,
        ),
      );
      if (!result || !Array.isArray(result.results)) throw new Error("TMDB returned invalid data");
      return Response.json({
        movies: result.results
          .filter(isTmdbMovie)
          .filter((movie) => movie.adult !== true)
          .map(cleanMovie),
      });
    } catch (error) {
      return apiError(error instanceof Error ? error : null);
    }
  }
  const movieReleaseMatch = url.pathname.match(/^\/api\/admin\/movies\/(\d+)\/releases$/);
  if (movieReleaseMatch && request.method === "GET") {
    const authorization = await authorizeCostly(
      request,
      env,
      metadata,
      "discovery",
      30,
      "stream.manage",
    );
    if (authorization instanceof Response) return authorization;
    try {
      const movieId = Number(movieReleaseMatch[1]);
      const external = await cache.getOrLoad(
        `tmdb/movie/${movieId}/external-ids`,
        7 * 24 * 60 * 60,
        () =>
          tmdb<{
            imdb_id: string | null;
          }>(`/movie/${movieId}/external_ids`, env),
      );
      if (!external.imdb_id || !/^tt\d+$/.test(external.imdb_id))
        throw new Error("This movie has no IMDb ID");

      const addon = await cache.getOrLoad(
        `stremio/movie/${external.imdb_id}`,
        30 * 60,
        async () => {
          const { data } = await fetchJson<JsonValue>(
            `${addonBase(env)}/stream/movie/${external.imdb_id}.json`,
            {
              headers: { Accept: "application/json" },
              maxBytes: 2000000,
              name: "Movie addon",
              timeoutMs: 15000,
            },
          );
          if (!isJsonObject(data) || (data.streams !== undefined && !Array.isArray(data.streams))) {
            throw new Error("Movie addon returned invalid data");
          }
          return { streams: Array.isArray(data.streams) ? data.streams : [] };
        },
      );
      const seen = new Set<string>();
      const candidates = addon.streams
        .filter(isStremioStream)
        .flatMap((stream) => {
          const hash = stream.infoHash?.toLowerCase();
          const fileIndex = isInteger(stream.fileIdx) ? stream.fileIdx : null;
          if (!hash || !/^[a-f0-9]{40}$/.test(hash)) return [];
          const key = `${hash}:${fileIndex ?? ""}`;
          if (seen.has(key)) return [];
          seen.add(key);
          const label = [stream.name, stream.title].filter(Boolean).join(" · ");
          return [
            {
              fileIndex,
              hash,
              label: label || hash,
              score: releaseScore(label),
              trackers: (stream.sources ?? [])
                .filter((source) => source.startsWith("tracker:"))
                .map((source) => source.slice(8))
                .filter((tracker) => tracker.startsWith("https://") || tracker.startsWith("udp://"))
                .slice(0, 20),
            },
          ];
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);
      const cachedHashes = await cache.getOrLoad(
        `torbox/movie/${external.imdb_id}/cached`,
        10 * 60,
        async () => {
          const query = new URLSearchParams({ format: "object", list_files: "false" });
          for (const release of candidates) query.append("hash", release.hash);
          const data =
            candidates.length > 0
              ? await torBox<JsonValue>(`/v1/api/torrents/checkcached?${query}`, env)
              : null;
          return Object.fromEntries(
            candidates.map((release) => [release.hash, torrentCached(data, release.hash)]),
          );
        },
      );
      const releases = candidates.map((release) => ({
        ...release,
        cached: cachedHashes[release.hash] === true,
      }));
      releases.sort((a, b) => Number(b.cached) - Number(a.cached) || b.score - a.score);
      return Response.json({ imdbId: external.imdb_id, releases });
    } catch (error) {
      return apiError(error instanceof Error ? error : null);
    }
  }
  if (url.pathname === "/api/admin/movies/add" && request.method === "POST") {
    const authorization = await authorizeCostly(
      request,
      env,
      metadata,
      "mutation",
      10,
      "stream.manage",
    );
    if (authorization instanceof Response) return authorization;
    try {
      const input = await jsonObject(request);
      const hash = isString(input.hash) ? input.hash.toLowerCase() : "";
      if (!/^[a-f0-9]{40}$/.test(hash))
        return Response.json({ error: "A valid torrent hash is required" }, { status: 400 });
      const magnet = new URL("magnet:?");
      magnet.searchParams.set("xt", `urn:btih:${hash}`);
      if (isString(input.title)) magnet.searchParams.set("dn", input.title.slice(0, 200));
      const trackers = Array.isArray(input.trackers) ? input.trackers.filter(isString) : [];
      for (const tracker of trackers.slice(0, 20)) {
        if (tracker.startsWith("https://") || tracker.startsWith("udp://"))
          magnet.searchParams.append("tr", tracker);
      }
      const body = new FormData();
      body.set("magnet", magnet.toString());
      const { data: result } = await fetchJson<TorBoxResponse<JsonValue>>(
        "https://api.torbox.app/v1/api/torrents/createtorrent",
        {
          body,
          headers: { Authorization: `Bearer ${env.TORBOX_API_KEY}` },
          method: "POST",
          name: "TorBox create",
          timeoutMs: 15000,
        },
      );
      if (!result.success) throw new Error("Could not add movie to TorBox");
      cache.invalidatePrefix("torbox/movie/");
      return Response.json({
        detail: result.detail || "Movie added to TorBox",
      });
    } catch (error) {
      return apiError(error instanceof Error ? error : null);
    }
  }
  return null;
}
