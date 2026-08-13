import { createSession, readCookie, readSession, sessionCookie, type Viewer } from "./session";
import { TtlCache } from "../server/cache";
import { fetchJson } from "../server/upstream";
import { parseRestreamRequest, RestreamValidationError } from "./restream";

export interface Env {
  ADMIN_DISCORD_IDS: string;
  APP_VERSION?: string;
  APP_URL: string;
  API_URL?: string;
  CHAT_DB_PATH?: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_GUILD_ID: string;
  DISCORD_ROLE_PERMISSIONS: string;
  DEV_USER_JSON?: string;
  ENABLE_DEV_AUTH?: string;
  NODE_ENV?: string;
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

export type RequestMetadata = {
  peerAddress?: string;
};

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
const rateLimits = new Map<string, { count: number; started: number }>();
let controllerQueue: Promise<void> = Promise.resolve();

class ClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

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

async function requirePermission(
  request: Request,
  env: Env,
  permission: string,
  metadata?: RequestMetadata,
) {
  const viewer = await viewerForRequest(request, env, metadata);
  return viewer && (viewer.admin || (viewer.permissions ?? []).includes(permission))
    ? viewer
    : null;
}

function isLoopback(address: string | undefined) {
  if (!address) return false;
  const normalized = address.toLowerCase().split("%")[0];
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

async function viewerForRequest(request: Request, env: Env, metadata?: RequestMetadata) {
  const session = await readSession(request, env.SESSION_SECRET);
  if (session) return session;

  if (
    env.ENABLE_DEV_AUTH !== "true" ||
    env.NODE_ENV === "production" ||
    !isLoopback(metadata?.peerAddress)
  )
    return null;
  const hostname = new URL(request.url).hostname;
  const appHostname = new URL(env.APP_URL).hostname;
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!localHosts.has(hostname) || !localHosts.has(appHostname)) return null;
  try {
    const parsed: unknown = env.DEV_USER_JSON ? JSON.parse(env.DEV_USER_JSON) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const configured = parsed as Partial<Viewer>;
    if (
      (configured.admin !== undefined && typeof configured.admin !== "boolean") ||
      (configured.avatar !== undefined &&
        configured.avatar !== null &&
        typeof configured.avatar !== "string") ||
      (configured.id !== undefined && typeof configured.id !== "string") ||
      (configured.name !== undefined && typeof configured.name !== "string") ||
      (configured.permissions !== undefined &&
        (!Array.isArray(configured.permissions) ||
          !configured.permissions.every((permission) => typeof permission === "string")))
    ) {
      throw new Error();
    }
    return {
      admin: configured.admin ?? true,
      avatar: configured.avatar ?? null,
      expires: Date.now() + 8 * 60 * 60 * 1_000,
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
    const parsed: unknown = JSON.parse(env.DISCORD_ROLE_PERMISSIONS || "{}");
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !Object.values(parsed).every(
        (permissions) =>
          Array.isArray(permissions) &&
          permissions.every((permission) => typeof permission === "string"),
      )
    ) {
      throw new Error();
    }
    const configured = parsed as Record<string, string[]>;
    return [...new Set(roleIds.flatMap((roleId) => configured[roleId] ?? []))];
  } catch {
    throw new Error("DISCORD_ROLE_PERMISSIONS must map Discord role IDs to permission arrays");
  }
}

async function torBox<T>(path: string, env: Env) {
  const { data: result } = await fetchJson<TorBoxResponse<T>>(`https://api.torbox.app${path}`, {
    headers: { Authorization: `Bearer ${env.TORBOX_API_KEY}` },
    maxBytes: 4_000_000,
    name: "TorBox",
    timeoutMs: 10_000,
  });
  if (!result || typeof result !== "object" || result.success !== true || !("data" in result)) {
    throw new Error("TorBox request failed");
  }
  return result.data;
}

async function cachedData<T>(key: string, maxAge: number, load: () => Promise<T>) {
  return cache.getOrLoad(key, maxAge, load);
}

async function tmdb<T>(path: string, env: Env) {
  if (!env.TMDB_API_TOKEN) throw new Error("TMDB_API_TOKEN is not configured");
  const { data } = await fetchJson<T>(`https://api.themoviedb.org/3${path}`, {
    headers: { Authorization: `Bearer ${env.TMDB_API_TOKEN}` },
    name: "TMDB",
    timeoutMs: 10_000,
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

function isTmdbMovie(movie: unknown): movie is TmdbMovie {
  if (!movie || typeof movie !== "object") return false;
  const value = movie as Partial<TmdbMovie>;
  return (
    Number.isInteger(value.id) &&
    typeof value.title === "string" &&
    typeof value.overview === "string" &&
    typeof value.release_date === "string" &&
    typeof value.vote_average === "number" &&
    (value.backdrop_path === null || typeof value.backdrop_path === "string") &&
    (value.poster_path === null || typeof value.poster_path === "string")
  );
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
  if (Array.isArray(data))
    return data.some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "hash" in entry &&
        String(entry.hash).toLowerCase() === hash,
    );
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
  const { data: result } = await fetchJson<
    Record<string, unknown> & {
      detail?: string;
      error?: string;
      running?: boolean;
      title?: string | null;
    }
  >(url, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    method,
    maxBytes: 256_000,
    name: "Stream controller",
    timeoutMs: action === "probe" || action === "restream" ? 30_000 : 10_000,
  });
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("Stream controller returned invalid data");
  return result;
}

function streamInfoCacheKey(env: Env) {
  return `stream-info:${env.RELAY_CONTROLLER_URL || env.STREAM_CONTROLLER_URL}:${env.STREAM_URL}`;
}

async function streamInfo(env: Env) {
  return cachedData(streamInfoCacheKey(env), 5, async () => {
    const [relay, upstream] = await Promise.all([
      controller(env, "GET")
        .then((status) => ({ running: status.running === true, title: status.title ?? null }))
        .catch(() => ({ running: false, title: null })),
      fetch(env.STREAM_URL, {
        headers: { Accept: "application/vnd.apple.mpegurl" },
        signal: AbortSignal.timeout(5_000),
      })
        .then(async (response) => {
          await response.body?.cancel();
          return { online: response.ok, upstreamStatus: response.status };
        })
        .catch(() => ({ online: false, upstreamStatus: null })),
    ]);
    return { ...relay, ...upstream };
  });
}

async function mutateController(env: Env, body: object) {
  const result = await serializedController(() => controller(env, "POST", body));
  cache.invalidate(streamInfoCacheKey(env));
  return result;
}

function apiError(error: unknown) {
  return Response.json(
    { error: error instanceof Error ? error.message : "Unexpected request failure" },
    { status: error instanceof ClientError ? error.status : 502 },
  );
}

function rateLimit(viewer: Viewer, bucket: string, limit: number, windowMs = 60_000) {
  const key = `${viewer.id}:${bucket}`;
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || now - current.started >= windowMs) {
    if (rateLimits.size > 5_000) {
      for (const [entryKey, entry] of rateLimits) {
        if (now - entry.started >= windowMs) rateLimits.delete(entryKey);
      }
    }
    rateLimits.set(key, { count: 1, started: now });
    return null;
  }
  current.count += 1;
  if (current.count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((current.started + windowMs - now) / 1_000));
  return Response.json(
    { error: "Too many requests" },
    { headers: { "Retry-After": String(retryAfter) }, status: 429 },
  );
}

async function authorizeCostly(
  request: Request,
  env: Env,
  metadata: RequestMetadata | undefined,
  bucket: string,
  limit: number,
  permission?: string,
) {
  const viewer = permission
    ? await requirePermission(request, env, permission, metadata)
    : await viewerForRequest(request, env, metadata);
  if (!viewer)
    return Response.json(
      { error: permission ? "Forbidden" : "Unauthorized" },
      { status: permission ? 403 : 401 },
    );
  return rateLimit(viewer, bucket, limit) ?? viewer;
}

async function serializedController<T>(operation: () => Promise<T>) {
  const previous = controllerQueue;
  let release!: () => void;
  controllerQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function jsonObject(request: Request) {
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new ClientError("A JSON object is required", 400);
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ClientError) throw error;
    throw new ClientError("Malformed JSON", 400);
  }
}

function mutationGuard(request: Request, env: Env, pathname: string) {
  if (!pathname.startsWith("/api/") || ["GET", "HEAD", "OPTIONS"].includes(request.method))
    return null;
  if (request.headers.get("Origin") !== new URL(env.APP_URL).origin) {
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  }
  const jsonRoutes = new Set([
    "/api/admin/movies/add",
    "/api/admin/restream/start",
    "/api/admin/torbox/options",
    "/api/admin/torbox/start",
  ]);
  if (
    jsonRoutes.has(pathname) &&
    request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/json"
  ) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

async function temporaryDownload(env: Env, torrentId: number, fileId: number) {
  const query = new URLSearchParams({
    file_id: String(fileId),
    token: env.TORBOX_API_KEY,
    torrent_id: String(torrentId),
    zip_link: "false",
  });
  const { data: result } = await fetchJson<TorBoxResponse<string>>(
    `https://api.torbox.app/v1/api/torrents/requestdl?${query}`,
    {
      name: "TorBox download",
      timeoutMs: 10_000,
    },
  );
  if (!result || typeof result !== "object" || result.success !== true)
    throw new Error("Could not create TorBox download URL");
  if (!result.data?.startsWith("https://"))
    throw new Error("TorBox returned an invalid download URL");
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
    const { data: token, response: tokenResponse } = await fetchJson<{ access_token?: unknown }>(
      "https://discord.com/api/oauth2/token",
      {
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          client_secret: env.DISCORD_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri(request, env),
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
        name: "Discord OAuth",
        requireOk: false,
        timeoutMs: 10_000,
      },
    );
    if (!tokenResponse.ok) throw new Error("Discord token exchange failed");
    if (typeof token.access_token !== "string" || !token.access_token)
      throw new Error("Discord token exchange failed");
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const [userResult, memberResult] = await Promise.all([
      fetchJson<unknown>("https://discord.com/api/users/@me", {
        headers,
        name: "Discord API",
        requireOk: false,
        timeoutMs: 10_000,
      }),
      fetchJson<unknown>(
        `https://discord.com/api/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`,
        {
          headers,
          name: "Discord API",
          requireOk: false,
          timeoutMs: 10_000,
        },
      ),
    ]);
    if (!userResult.response.ok || !memberResult.response.ok) {
      return redirect(
        `${env.APP_URL.replace(/\/$/, "")}/?error=not-a-member`,
        oauthCookie("", request, 0),
      );
    }

    const user = userResult.data as Partial<DiscordUser> | null;
    const member = memberResult.data as { roles?: unknown } | null;
    if (
      !user ||
      typeof user.id !== "string" ||
      typeof user.username !== "string" ||
      (user.avatar !== null && typeof user.avatar !== "string") ||
      (user.global_name !== null && typeof user.global_name !== "string") ||
      !member ||
      !Array.isArray(member.roles) ||
      !member.roles.every((role) => typeof role === "string")
    ) {
      throw new Error("Discord API returned invalid data");
    }

    const avatar = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128`
      : null;
    const admins = new Set(
      env.ADMIN_DISCORD_IDS.split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const permissions = permissionsForRoles(member.roles, env);
    const admin = admins.has(user.id) || permissions.includes("admin");
    if (admin) {
      if (!permissions.includes("stream.manage")) permissions.push("stream.manage");
      if (!permissions.includes("chloe.chat")) permissions.push("chloe.chat");
    }
    const session = await createSession(
      {
        admin,
        avatar,
        id: user.id,
        name: user.global_name ?? user.username,
        permissions,
      },
      env.SESSION_SECRET,
    );
    return redirect(env.APP_URL, sessionCookie(session, undefined, isSecure(request)));
  } catch {
    return redirect(`${env.APP_URL.replace(/\/$/, "")}/?error=oauth`, oauthCookie("", request, 0));
  }
}

export async function authenticateRoomMember(
  request: Request,
  env: Env,
  metadata?: RequestMetadata,
) {
  const viewer = await viewerForRequest(request, env, metadata);
  if (!viewer) return null;
  return {
    expires: viewer.expires,
    member: {
      admin: viewer.admin,
      avatar: viewer.avatar,
      id: viewer.id,
      name: viewer.name,
    } satisfies RoomMember,
  };
}

async function routeRequest(request: Request, env: Env, metadata?: RequestMetadata) {
  const url = new URL(request.url);
  const rejectedMutation = mutationGuard(request, env, url.pathname);
  if (rejectedMutation) return rejectedMutation;
  if (url.pathname === "/auth/discord" && request.method === "GET") return beginLogin(request, env);
  if (url.pathname === "/auth/callback" && request.method === "GET")
    return finishLogin(request, env);

  if (url.pathname === "/api/session" && request.method === "GET") {
    const viewer = await viewerForRequest(request, env, metadata);
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
    return new Response(null, {
      headers: { "Set-Cookie": sessionCookie("", 0, isSecure(request)) },
      status: 204,
    });
  }
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
      const result = await cachedData(cacheKey, maxAge, () =>
        tmdb<{ results: TmdbMovie[] }>(
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
      return apiError(error);
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
      const external = await cachedData(
        `tmdb/movie/${movieId}/external-ids`,
        7 * 24 * 60 * 60,
        () => tmdb<{ imdb_id: string | null }>(`/movie/${movieId}/external_ids`, env),
      );
      if (!external.imdb_id || !/^tt\d+$/.test(external.imdb_id))
        throw new Error("This movie has no IMDb ID");

      const addon = await cachedData(`stremio/movie/${external.imdb_id}`, 30 * 60, async () => {
        const { data } = await fetchJson<{ streams?: StremioStream[] }>(
          `${addonBase(env)}/stream/movie/${external.imdb_id}.json`,
          {
            headers: { Accept: "application/json" },
            maxBytes: 2_000_000,
            name: "Movie addon",
            timeoutMs: 15_000,
          },
        );
        if (
          !data ||
          typeof data !== "object" ||
          (data.streams !== undefined && !Array.isArray(data.streams))
        ) {
          throw new Error("Movie addon returned invalid data");
        }
        return data;
      });
      const seen = new Set<string>();
      const candidates = (addon.streams ?? [])
        .filter((stream): stream is StremioStream => Boolean(stream) && typeof stream === "object")
        .flatMap((stream) => {
          const hash = stream.infoHash?.toLowerCase();
          const fileIndex = Number.isInteger(stream.fileIdx) ? stream.fileIdx! : null;
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
              trackers: (Array.isArray(stream.sources) ? stream.sources : [])
                .filter((source): source is string => typeof source === "string")
                .filter((source) => source.startsWith("tracker:"))
                .map((source) => source.slice(8))
                .filter((tracker) => tracker.startsWith("https://") || tracker.startsWith("udp://"))
                .slice(0, 20),
            },
          ];
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);
      const cachedHashes = await cachedData(
        `torbox/movie/${external.imdb_id}/cached`,
        10 * 60,
        async () => {
          const query = new URLSearchParams({ format: "object", list_files: "false" });
          for (const release of candidates) query.append("hash", release.hash);
          const data =
            candidates.length > 0
              ? await torBox<unknown>(`/v1/api/torrents/checkcached?${query}`, env)
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
      return apiError(error);
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
      const hash = typeof input.hash === "string" ? input.hash.toLowerCase() : "";
      if (!/^[a-f0-9]{40}$/.test(hash))
        return Response.json({ error: "A valid torrent hash is required" }, { status: 400 });
      const magnet = new URL("magnet:?");
      magnet.searchParams.set("xt", `urn:btih:${hash}`);
      if (typeof input.title === "string") magnet.searchParams.set("dn", input.title.slice(0, 200));
      const trackers = Array.isArray(input.trackers)
        ? input.trackers.filter((tracker): tracker is string => typeof tracker === "string")
        : [];
      for (const tracker of trackers.slice(0, 20)) {
        if (tracker.startsWith("https://") || tracker.startsWith("udp://"))
          magnet.searchParams.append("tr", tracker);
      }
      const body = new FormData();
      body.set("magnet", magnet.toString());
      const { data: result } = await fetchJson<TorBoxResponse<unknown>>(
        "https://api.torbox.app/v1/api/torrents/createtorrent",
        {
          body,
          headers: { Authorization: `Bearer ${env.TORBOX_API_KEY}` },
          method: "POST",
          name: "TorBox create",
          timeoutMs: 15_000,
        },
      );
      if (!result || typeof result !== "object" || !result.success)
        throw new Error("Could not add movie to TorBox");
      cache.invalidatePrefix("torbox/movie/");
      return Response.json({
        detail:
          typeof result.detail === "string" && result.detail
            ? result.detail
            : "Movie added to TorBox",
      });
    } catch (error) {
      return apiError(error);
    }
  }
  if (url.pathname === "/api/admin/torbox/torrents" && request.method === "GET") {
    const authorization = await authorizeCostly(
      request,
      env,
      metadata,
      "torbox-list",
      30,
      "stream.manage",
    );
    if (authorization instanceof Response) return authorization;
    try {
      const torrents = await torBox<TorBoxTorrent[]>(
        `/v1/api/torrents/mylist?bypass_cache=${url.searchParams.get("refresh") === "1" ? "true" : "false"}&offset=0&limit=100`,
        env,
      );
      if (!Array.isArray(torrents)) throw new Error("TorBox returned invalid data");
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
    const authorization = await authorizeCostly(
      request,
      env,
      metadata,
      "controller-mutation",
      10,
      "stream.manage",
    );
    if (authorization instanceof Response) return authorization;
    try {
      const input = await jsonObject(request);
      if (!Number.isInteger(input.torrentId) || !Number.isInteger(input.fileId)) {
        return Response.json({ error: "A valid torrent and file are required" }, { status: 400 });
      }
      const source = await temporaryDownload(
        env,
        input.torrentId as number,
        input.fileId as number,
      );
      return Response.json(await controller(env, "POST", { action: "probe", source }));
    } catch (error) {
      return apiError(error);
    }
  }
  if (url.pathname === "/api/admin/torbox/start" && request.method === "POST") {
    const authorization = await authorizeCostly(
      request,
      env,
      metadata,
      "controller-mutation",
      10,
      "stream.manage",
    );
    if (authorization instanceof Response) return authorization;
    try {
      const input = await jsonObject(request);
      if (!Number.isInteger(input.torrentId) || !Number.isInteger(input.fileId)) {
        return Response.json({ error: "A valid torrent and file are required" }, { status: 400 });
      }
      const source = await temporaryDownload(
        env,
        input.torrentId as number,
        input.fileId as number,
      );
      await mutateController(env, {
        action: "start",
        audioIndex: Number.isInteger(input.audioIndex) ? input.audioIndex : 0,
        resolutionIndex: Number.isInteger(input.resolutionIndex) ? input.resolutionIndex : null,
        source,
        subtitleIndex: Number.isInteger(input.subtitleIndex) ? input.subtitleIndex : null,
        title:
          typeof input.title === "string"
            ? input.title.slice(0, 200) || "TorBox stream"
            : "TorBox stream",
      });
      return Response.json({ detail: "Stream is starting" });
    } catch (error) {
      return apiError(error);
    }
  }
  if (url.pathname === "/api/admin/restream/start" && request.method === "POST") {
    const authorization = await authorizeCostly(
      request,
      env,
      metadata,
      "controller-mutation",
      10,
      "stream.manage",
    );
    if (authorization instanceof Response) return authorization;
    try {
      const restream = parseRestreamRequest(await jsonObject(request));
      const result = await mutateController(env, {
        action: "restream",
        quality: restream.quality,
        source: restream.source,
        title: restream.title,
      });
      return Response.json({
        detail: "Restream is starting",
        platform: restream.platform,
        quality: restream.quality,
        title:
          typeof result.title === "string" && result.title.trim()
            ? result.title.trim().slice(0, 200)
            : restream.title,
      });
    } catch (error) {
      if (error instanceof RestreamValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      return apiError(error);
    }
  }
  if (
    ["/api/admin/stream/stop", "/api/admin/torbox/stop"].includes(url.pathname) &&
    request.method === "POST"
  ) {
    const authorization = await authorizeCostly(
      request,
      env,
      metadata,
      "controller-mutation",
      10,
      "stream.manage",
    );
    if (authorization instanceof Response) return authorization;
    try {
      return Response.json(await mutateController(env, { action: "stop" }));
    } catch (error) {
      return apiError(error);
    }
  }
  if (
    ["/api/admin/stream/status", "/api/admin/torbox/status"].includes(url.pathname) &&
    request.method === "GET"
  ) {
    const authorization = await authorizeCostly(
      request,
      env,
      metadata,
      "controller-read",
      60,
      "stream.manage",
    );
    if (authorization instanceof Response) return authorization;
    try {
      return Response.json(await controller(env, "GET"));
    } catch (error) {
      return apiError(error);
    }
  }
  if (url.pathname === "/api/stream-info" && request.method === "GET") {
    const authorization = await authorizeCostly(request, env, metadata, "stream-info", 60);
    if (authorization instanceof Response) return authorization;
    return Response.json(await streamInfo(env), { headers: { "Cache-Control": "no-store" } });
  }
  if (url.pathname === "/api/room" && request.method === "GET")
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ error: "Not found" }, { status: 404 });
}

export async function handleRequest(request: Request, env: Env, metadata?: RequestMetadata) {
  const response = await routeRequest(request, env, metadata);
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith("/api/") || pathname.startsWith("/auth/")) {
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}
