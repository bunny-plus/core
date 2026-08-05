import { createSession, readCookie, readSession, sessionCookie, type Viewer } from "./session";
import { TtlCache } from "../server/cache";

export interface Env {
  ADMIN_DISCORD_IDS: string;
  APP_VERSION?: string;
  APP_URL: string;
  API_URL?: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_GUILD_ID: string;
  DISCORD_ROLE_PERMISSIONS: string;
  DEV_USER_JSON?: string;
  SESSION_SECRET: string;
  STREAM_DELAY_SECONDS: string;
  RELAY_CONTROLLER_SECRET?: string;
  RELAY_CONTROLLER_URL?: string;
  STREAM_CONTROLLER_SECRET?: string;
  STREAM_CONTROLLER_URL?: string;
  STREAM_URL: string;
  STREMIO_ADDON_URL?: string;
  TMDB_API_TOKEN?: string;
  TORBOX_API_KEY: string;
}

type DiscordUser = {
  avatar: string | null;
  global_name: string | null;
  id: string;
  username: string;
};

export type RoomMember = Pick<Viewer, "admin" | "avatar" | "id" | "name">;

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

type TorBoxResponse<T> = {
  data: T;
  detail: string;
  error: string | null;
  success: boolean;
};

const cache = new TtlCache(500);

function redirectUri(request: Request, env: Env) {
  return `${(env.API_URL || new URL(request.url).origin).replace(/\/$/, "")}/auth/callback`;
}

function isSecure(request: Request) {
  return new URL(request.url).protocol === "https:";
}

function oauthCookie(value: string, request: Request, maxAge = 600) {
  return `bp_oauth=${value}; Path=/auth/callback; HttpOnly${isSecure(request) ? "; Secure" : ""}; SameSite=Lax; Max-Age=${maxAge}`;
}

function redirect(location: string, cookie?: string) {
  const headers = new Headers({ Location: location });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(null, { headers, status: 302 });
}

async function requirePermission(request: Request, env: Env, permission: string) {
  const viewer = await viewerForRequest(request, env);
  return viewer && (viewer.admin || (viewer.permissions ?? []).includes(permission)) ? viewer : null;
}

async function viewerForRequest(request: Request, env: Env) {
  const session = await readSession(request, env.SESSION_SECRET);
  if (session) return session;

  const hostname = new URL(request.url).hostname;
  const appHostname = new URL(env.APP_URL).hostname;
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (!localHosts.has(hostname) || !localHosts.has(appHostname)) return null;
  try {
    const configured = env.DEV_USER_JSON ? JSON.parse(env.DEV_USER_JSON) as Partial<Viewer> : {};
    return {
      admin: configured.admin ?? true,
      avatar: configured.avatar ?? null,
      expires: Date.now() + 24 * 60 * 60 * 1_000,
      id: configured.id ?? "local-dev",
      name: configured.name ?? "Local Bunny",
      permissions: configured.permissions ?? ["admin", "stream.manage", "chloe.chat"],
    } satisfies Viewer;
  } catch {
    throw new Error("DEV_USER_JSON must contain a valid local Viewer object");
  }
}

function permissionsForRoles(roleIds: string[], env: Env) {
  try {
    const configured = JSON.parse(env.DISCORD_ROLE_PERMISSIONS || "{}") as Record<string, string[]>;
    return [...new Set(roleIds.flatMap((roleId) => configured[roleId] ?? []))];
  } catch {
    throw new Error("DISCORD_ROLE_PERMISSIONS must map Discord role IDs to permission arrays");
  }
}

async function torBox<T>(path: string, env: Env) {
  const response = await fetch(`https://api.torbox.app${path}`, {
    headers: { Authorization: `Bearer ${env.TORBOX_API_KEY}` },
  });
  const result = await response.json() as TorBoxResponse<T>;
  if (!response.ok || !result.success) throw new Error(result.detail || "TorBox request failed");
  return result.data;
}

async function cachedData<T>(key: string, maxAge: number, load: () => Promise<T>) {
  return cache.getOrLoad(key, maxAge, load);
}

async function responsePreview(response: Response, limit = 512) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const bytes = new Uint8Array(limit);
  let length = 0;
  try {
    while (length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, limit - length);
      bytes.set(chunk, length);
      length += chunk.length;
    }
  } finally {
    await reader.cancel();
  }
  return new TextDecoder().decode(bytes.subarray(0, length)).replace(/\s+/g, " ").trim();
}

async function tmdb<T>(path: string, env: Env) {
  if (!env.TMDB_API_TOKEN) throw new Error("TMDB_API_TOKEN is not configured");
  const response = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: { Authorization: `Bearer ${env.TMDB_API_TOKEN}` },
  });
  if (!response.ok) throw new Error(`TMDB request failed (${response.status})`);
  return response.json() as Promise<T>;
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

function torrentCached(data: unknown, hash: string) {
  if (!data) return false;
  if (Array.isArray(data)) return data.some((entry) => (
    typeof entry === "object" && entry !== null && "hash" in entry && String(entry.hash).toLowerCase() === hash
  ));
  if (typeof data !== "object") return false;
  const entries = data as Record<string, unknown>;
  const match = entries[hash] ?? entries[hash.toLowerCase()] ?? entries[hash.toUpperCase()];
  return match === undefined ? String(entries.hash ?? "").toLowerCase() === hash : Boolean(match);
}

function releaseScore(label: string) {
  const normalized = label.toLowerCase();
  if (/2160p|4k/.test(normalized)) return 4;
  if (/1080p/.test(normalized)) return 3;
  if (/720p/.test(normalized)) return 2;
  return 1;
}

async function controller(env: Env, method: "GET" | "POST", body?: object) {
  const url = env.RELAY_CONTROLLER_URL || env.STREAM_CONTROLLER_URL;
  const secret = env.RELAY_CONTROLLER_SECRET || env.STREAM_CONTROLLER_SECRET;
  if (!url || !secret) throw new Error("Relay controller is not configured");
  const action = body && "action" in body ? body.action : null;
  const response = await fetch(url, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    method,
    signal: AbortSignal.timeout(action === "probe" ? 30_000 : 10_000),
  });
  const result = await response.json() as Record<string, unknown> & { detail?: string; error?: string; running?: boolean; title?: string | null };
  if (!response.ok) throw new Error(result.detail || result.error || "Stream controller request failed");
  return result;
}

function apiError(error: unknown) {
  return Response.json(
    { error: error instanceof Error ? error.message : "Unexpected request failure" },
    { status: 502 },
  );
}

async function temporaryDownload(env: Env, torrentId: number, fileId: number) {
  const query = new URLSearchParams({
    file_id: String(fileId),
    token: env.TORBOX_API_KEY,
    torrent_id: String(torrentId),
    zip_link: "false",
  });
  const response = await fetch(`https://api.torbox.app/v1/api/torrents/requestdl?${query}`);
  const result = await response.json() as TorBoxResponse<string>;
  if (!response.ok || !result.success) throw new Error(result.detail || "Could not create TorBox download URL");
  if (!result.data?.startsWith("https://")) throw new Error("TorBox returned an invalid download URL");
  return result.data;
}

async function beginLogin(request: Request, env: Env) {
  const state = crypto.randomUUID();
  const authorization = new URL("https://discord.com/oauth2/authorize");
  authorization.search = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri(request, env),
    response_type: "code",
    scope: "identify guilds.members.read",
    state,
  }).toString();
  return redirect(authorization.toString(), oauthCookie(state, request));
}

async function finishLogin(request: Request, env: Env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== readCookie(request, "bp_oauth")) {
    return redirect(`${env.APP_URL.replace(/\/$/, "")}/?error=oauth`, oauthCookie("", request, 0));
  }

  try {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(request, env),
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    if (!tokenResponse.ok) throw new Error("Discord token exchange failed");
    const token = (await tokenResponse.json()) as { access_token: string };
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const [userResponse, memberResponse] = await Promise.all([
      fetch("https://discord.com/api/users/@me", { headers }),
      fetch(`https://discord.com/api/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`, { headers }),
    ]);
    if (!userResponse.ok || !memberResponse.ok) {
      return redirect(`${env.APP_URL.replace(/\/$/, "")}/?error=not-a-member`, oauthCookie("", request, 0));
    }

    const user = (await userResponse.json()) as DiscordUser;
    const member = (await memberResponse.json()) as { roles: string[] };

    const avatar = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128`
      : null;
    const admins = new Set(env.ADMIN_DISCORD_IDS.split(",").map((id) => id.trim()).filter(Boolean));
    const permissions = permissionsForRoles(member.roles ?? [], env);
    const admin = admins.has(user.id) || permissions.includes("admin");
    if (admin) {
      if (!permissions.includes("stream.manage")) permissions.push("stream.manage");
      if (!permissions.includes("chloe.chat")) permissions.push("chloe.chat");
    }
    const session = await createSession({
      admin,
      avatar,
      id: user.id,
      name: user.global_name ?? user.username,
      permissions,
    }, env.SESSION_SECRET);
    return redirect(env.APP_URL, sessionCookie(session, undefined, isSecure(request)));
  } catch {
    return redirect(`${env.APP_URL.replace(/\/$/, "")}/?error=oauth`, oauthCookie("", request, 0));
  }
}

export async function authenticateRoomMember(request: Request, env: Env): Promise<RoomMember | null> {
  const viewer = await viewerForRequest(request, env);
  if (!viewer) return null;
  return {
    admin: viewer.admin,
    avatar: viewer.avatar,
    id: viewer.id,
    name: viewer.name,
  };
}

export async function handleRequest(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/auth/discord" && request.method === "GET") return beginLogin(request, env);
    if (url.pathname === "/auth/callback" && request.method === "GET") return finishLogin(request, env);

    if (url.pathname === "/api/session" && request.method === "GET") {
      const viewer = await viewerForRequest(request, env);
      if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return Response.json({
        delaySeconds: Number(env.STREAM_DELAY_SECONDS || 6),
        streamUrl: env.STREAM_URL,
        user: {
          admin: viewer.admin,
          avatar: viewer.avatar,
          id: viewer.id,
          name: viewer.name,
          permissions: viewer.permissions ?? [],
        },
      });
    }
    if (url.pathname === "/api/logout" && request.method === "POST") {
      return new Response(null, { headers: { "Set-Cookie": sessionCookie("", 0, isSecure(request)) }, status: 204 });
    }
    if (url.pathname === "/api/version" && request.method === "GET") {
      return Response.json(
        { version: env.APP_VERSION || "development" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (url.pathname === "/api/admin/movies" && request.method === "GET") {
      if (!await requirePermission(request, env, "stream.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
      try {
        const query = url.searchParams.get("q")?.trim().slice(0, 100) ?? "";
        const cacheKey = query ? `tmdb/search/${encodeURIComponent(query.toLowerCase())}` : "tmdb/trending/week";
        const maxAge = query ? 6 * 60 * 60 : 24 * 60 * 60;
        const result = await cachedData(cacheKey, maxAge, () => tmdb<{ results: TmdbMovie[] }>(
          query
            ? `/search/movie?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`
            : "/trending/movie/week?language=en-US",
          env,
        ));
        return Response.json({ movies: result.results.filter((movie) => movie.adult !== true).map(cleanMovie) });
      } catch (error) {
        return apiError(error);
      }
    }
    const movieReleaseMatch = url.pathname.match(/^\/api\/admin\/movies\/(\d+)\/releases$/);
    if (movieReleaseMatch && request.method === "GET") {
      if (!await requirePermission(request, env, "stream.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
      try {
        const movieId = Number(movieReleaseMatch[1]);
        const external = await cachedData(`tmdb/movie/${movieId}/external-ids`, 7 * 24 * 60 * 60, () => (
          tmdb<{ imdb_id: string | null }>(`/movie/${movieId}/external_ids`, env)
        ));
        if (!external.imdb_id || !/^tt\d+$/.test(external.imdb_id)) throw new Error("This movie has no IMDb ID");

        const addon = await cachedData(`stremio/movie/${external.imdb_id}`, 30 * 60, async () => {
          const response = await fetch(`${addonBase(env)}/stream/movie/${external.imdb_id}.json`, {
            headers: { Accept: "application/json" },
          });
          if (!response.ok) {
            console.error(JSON.stringify({
              cfRay: response.headers.get("cf-ray"),
              contentType: response.headers.get("content-type"),
              detail: await responsePreview(response),
              imdbId: external.imdb_id,
              message: "Movie addon request failed",
              server: response.headers.get("server"),
              status: response.status,
              upstream: "torrentio",
            }));
            throw new Error(`Movie addon request failed (${response.status})`);
          }
          return response.json() as Promise<{ streams?: StremioStream[] }>;
        });
        const seen = new Set<string>();
        const candidates = (addon.streams ?? [])
          .flatMap((stream) => {
            const hash = stream.infoHash?.toLowerCase();
            const fileIndex = Number.isInteger(stream.fileIdx) ? stream.fileIdx! : null;
            if (!hash || !/^[a-f0-9]{40}$/.test(hash)) return [];
            const key = `${hash}:${fileIndex ?? ""}`;
            if (seen.has(key)) return [];
            seen.add(key);
            const label = [stream.name, stream.title].filter(Boolean).join(" · ");
            return [{
              fileIndex,
              hash,
              label: label || hash,
              score: releaseScore(label),
              trackers: (stream.sources ?? [])
                .filter((source) => source.startsWith("tracker:"))
                .map((source) => source.slice(8))
                .filter((tracker) => tracker.startsWith("https://") || tracker.startsWith("udp://"))
                .slice(0, 20),
            }];
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 15);
        const cachedHashes = await cachedData(`torbox/movie/${external.imdb_id}/cached`, 10 * 60, async () => {
          const query = new URLSearchParams({ format: "object", list_files: "false" });
          for (const release of candidates) query.append("hash", release.hash);
          const data = candidates.length > 0
            ? await torBox<unknown>(`/v1/api/torrents/checkcached?${query}`, env)
            : null;
          return Object.fromEntries(candidates.map((release) => [release.hash, torrentCached(data, release.hash)]));
        });
        const releases = candidates.map((release) => ({ ...release, cached: cachedHashes[release.hash] === true }));
        releases.sort((a, b) => Number(b.cached) - Number(a.cached) || b.score - a.score);
        return Response.json({ imdbId: external.imdb_id, releases });
      } catch (error) {
        return apiError(error);
      }
    }
    if (url.pathname === "/api/admin/movies/add" && request.method === "POST") {
      if (!await requirePermission(request, env, "stream.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
      try {
        const input = await request.json() as { hash?: string; title?: string; trackers?: string[] };
        const hash = input.hash?.toLowerCase() ?? "";
        if (!/^[a-f0-9]{40}$/.test(hash)) return Response.json({ error: "A valid torrent hash is required" }, { status: 400 });
        const magnet = new URL("magnet:?");
        magnet.searchParams.set("xt", `urn:btih:${hash}`);
        if (input.title) magnet.searchParams.set("dn", input.title.slice(0, 200));
        for (const tracker of (input.trackers ?? []).slice(0, 20)) {
          if (tracker.startsWith("https://") || tracker.startsWith("udp://")) magnet.searchParams.append("tr", tracker);
        }
        const body = new FormData();
        body.set("magnet", magnet.toString());
        const response = await fetch("https://api.torbox.app/v1/api/torrents/createtorrent", {
          body,
          headers: { Authorization: `Bearer ${env.TORBOX_API_KEY}` },
          method: "POST",
        });
        const result = await response.json() as TorBoxResponse<unknown>;
        if (!response.ok || !result.success) throw new Error(result.detail || "Could not add movie to TorBox");
        return Response.json({ detail: result.detail || "Movie added to TorBox" });
      } catch (error) {
        return apiError(error);
      }
    }
    if (url.pathname === "/api/admin/torbox/torrents" && request.method === "GET") {
      if (!await requirePermission(request, env, "stream.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
      try {
        const torrents = await torBox<TorBoxTorrent[]>(
          `/v1/api/torrents/mylist?bypass_cache=${url.searchParams.get("refresh") === "1" ? "true" : "false"}&offset=0&limit=100`,
          env,
        );
        return Response.json({
          torrents: torrents.map((torrent) => ({
            download_finished: torrent.download_finished,
            download_present: torrent.download_present,
            files: (torrent.files ?? []).map((file) => ({
              id: file.id,
              infected: file.infected,
              mimetype: file.mimetype,
              name: file.name,
              short_name: file.short_name,
              size: file.size,
              zipped: file.zipped,
            })),
            id: torrent.id,
            name: torrent.name,
            progress: torrent.progress,
            size: torrent.size,
          })),
        });
      } catch (error) {
        return apiError(error);
      }
    }
    if (url.pathname === "/api/admin/torbox/options" && request.method === "POST") {
      if (!await requirePermission(request, env, "stream.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
      try {
        const input = await request.json() as { fileId?: number; torrentId?: number };
        if (!Number.isInteger(input.torrentId) || !Number.isInteger(input.fileId)) {
          return Response.json({ error: "A valid torrent and file are required" }, { status: 400 });
        }
        const source = await temporaryDownload(env, input.torrentId!, input.fileId!);
        return Response.json(await controller(env, "POST", { action: "probe", source }));
      } catch (error) {
        return apiError(error);
      }
    }
    if (url.pathname === "/api/admin/torbox/start" && request.method === "POST") {
      if (!await requirePermission(request, env, "stream.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
      try {
        const input = await request.json() as {
          audioIndex?: number;
          fileId?: number;
          resolutionIndex?: number | null;
          subtitleIndex?: number | null;
          title?: string;
          torrentId?: number;
        };
        if (!Number.isInteger(input.torrentId) || !Number.isInteger(input.fileId)) {
          return Response.json({ error: "A valid torrent and file are required" }, { status: 400 });
        }
        const source = await temporaryDownload(env, input.torrentId!, input.fileId!);
        await controller(env, "POST", {
          action: "start",
          audioIndex: Number.isInteger(input.audioIndex) ? input.audioIndex : 0,
          resolutionIndex: Number.isInteger(input.resolutionIndex) ? input.resolutionIndex : null,
          source,
          subtitleIndex: Number.isInteger(input.subtitleIndex) ? input.subtitleIndex : null,
          title: input.title?.slice(0, 200) || "TorBox stream",
        });
        return Response.json({ detail: "Stream is starting" });
      } catch (error) {
        return apiError(error);
      }
    }
    if (url.pathname === "/api/admin/torbox/stop" && request.method === "POST") {
      if (!await requirePermission(request, env, "stream.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
      try {
        return Response.json(await controller(env, "POST", { action: "stop" }));
      } catch (error) {
        return apiError(error);
      }
    }
    if (url.pathname === "/api/admin/torbox/status" && request.method === "GET") {
      if (!await requirePermission(request, env, "stream.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
      try {
        return Response.json(await controller(env, "GET"));
      } catch (error) {
        return apiError(error);
      }
    }
    if (url.pathname === "/api/stream-status" && request.method === "GET") {
      const viewer = await viewerForRequest(request, env);
      if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });
      try {
        const response = await fetch(env.STREAM_URL, {
          headers: { Accept: "application/vnd.apple.mpegurl" },
          signal: AbortSignal.timeout(5_000),
        });
        await response.body?.cancel();
        return Response.json(
          { online: response.ok, upstreamStatus: response.status },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch {
        return Response.json(
          { online: false, upstreamStatus: null },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    if (url.pathname === "/api/stream-info" && request.method === "GET") {
      const viewer = await viewerForRequest(request, env);
      if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });
      try {
        const status = await controller(env, "GET");
        return Response.json(
          { running: status.running === true, title: status.title ?? null },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch {
        return Response.json(
          { running: false, title: null },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    if (url.pathname === "/api/room" && request.method === "GET") return new Response("Expected a WebSocket upgrade", { status: 426 });
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
}
