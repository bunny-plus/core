import { createSession, readCookie, readSession, sessionCookie, type Viewer } from "./session";
import { TtlCache } from "../server/cache";
import type { CinemaDiary, CinemaImage } from "../server/cinema";
import { cinemaImageMaxBytes } from "../shared/cinema";
import { fetchJson, type JsonObject, type JsonValue } from "../server/upstream";
import { parseRestreamRequest, RestreamValidationError } from "./restream";
import {
  JellyfinError,
  jellyfinId,
  jellyfinLibrary,
  jellyfinOptions,
  jellyfinRelay,
  isJellyfinPlayback,
  jellyfinSubtitleSource,
  jellyfinSubtitleFile,
} from "../server/jellyfin";
import type { JellyfinPlayback } from "../shared/jellyfin";

export interface Env {
  ADMIN_DISCORD_IDS: string;
  APP_VERSION?: string;
  APP_URL: string;
  API_URL?: string;
  CHAT_DB_PATH?: string;
  CINEMA_DIARY?: CinemaDiary;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_GUILD_ID: string;
  DISCORD_ROLE_PERMISSIONS: string;
  DEV_USER_JSON?: string;
  ENABLE_DEV_AUTH?: string;
  JELLYFIN_URL?: string;
  JELLYFIN_STREAM_URL?: string;
  JELLYFIN_API_KEY?: string;
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

type DiscordMember = {
  roles: string[];
};

type ControllerResponse = {
  detail?: string;
  error?: string;
  running?: boolean;
  title?: string | null;
  jellyfin?: JellyfinPlayback | null;
};

type DevViewer = Partial<Omit<Viewer, "expires">>;
type RolePermissions = { [roleId: string]: string[] };

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

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isStringList(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isInteger(value: JsonValue | undefined): value is number {
  return Number.isInteger(value);
}

function hasSignature(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ticketImage(input: JsonValue | undefined): CinemaImage | null {
  if (input === undefined) return null;
  if (!isJsonObject(input) || !isString(input.mimeType) || !isString(input.data))
    throw new ClientError("A valid uploaded image is required", 400);
  if (!["image/png", "image/jpeg", "image/webp"].includes(input.mimeType))
    throw new ClientError("Upload a PNG, JPEG, or WebP image", 400);
  if (input.data.length > Math.ceil(cinemaImageMaxBytes / 3) * 4)
    throw new ClientError("Ticket images must be 2 MiB or smaller", 413);
  if (!input.data || input.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))
    throw new ClientError("The uploaded image is not valid base64", 400);
  let decoded: string;
  try {
    decoded = atob(input.data);
  } catch {
    throw new ClientError("The uploaded image is not valid base64", 400);
  }
  if (btoa(decoded) !== input.data)
    throw new ClientError("The uploaded image is not valid base64", 400);
  if (decoded.length > cinemaImageMaxBytes)
    throw new ClientError("Ticket images must be 2 MiB or smaller", 413);
  const data = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const validImage =
    (input.mimeType === "image/png" && hasSignature(data, [137, 80, 78, 71, 13, 10, 26, 10])) ||
    (input.mimeType === "image/jpeg" && hasSignature(data, [255, 216, 255])) ||
    (input.mimeType === "image/webp" &&
      data.length >= 16 &&
      hasSignature(data, [82, 73, 70, 70]) &&
      hasSignature(data, [87, 69, 66, 80], 8) &&
      hasSignature(data, [86, 80, 56], 12) &&
      [32, 76, 88].includes(data[15]));
  if (!validImage) throw new ClientError("The uploaded image does not match its file type", 400);
  return { mimeType: input.mimeType, data };
}

function isDevViewer(value: JsonValue): value is DevViewer {
  if (!isJsonObject(value)) return false;
  return (
    (value.admin === undefined || typeof value.admin === "boolean") &&
    (value.avatar === undefined || value.avatar === null || typeof value.avatar === "string") &&
    (value.id === undefined || typeof value.id === "string") &&
    (value.name === undefined || typeof value.name === "string") &&
    (value.permissions === undefined || isStringList(value.permissions))
  );
}

function isRolePermissions(value: JsonValue): value is RolePermissions {
  return isJsonObject(value) && Object.values(value).every(isStringList);
}

function isDiscordUser(value: JsonValue): value is DiscordUser {
  if (!isJsonObject(value)) return false;
  return (
    isString(value.id) &&
    isString(value.username) &&
    (value.avatar === null || isString(value.avatar)) &&
    (value.global_name === null || isString(value.global_name))
  );
}

function isDiscordMember(value: JsonValue): value is DiscordMember {
  return isJsonObject(value) && isStringList(value.roles);
}

function isControllerResponse(value: JsonValue): value is ControllerResponse {
  if (!isJsonObject(value)) return false;
  return (
    (value.detail === undefined || isString(value.detail)) &&
    (value.error === undefined || isString(value.error)) &&
    (value.running === undefined || typeof value.running === "boolean") &&
    (value.title === undefined || value.title === null || isString(value.title)) &&
    (value.jellyfin == null || isJellyfinPlayback(value.jellyfin))
  );
}

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
    const parsed: JsonValue = env.DEV_USER_JSON ? JSON.parse(env.DEV_USER_JSON) : {};
    if (!isDevViewer(parsed)) throw new Error();
    const configured = parsed;
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
    const parsed: JsonValue = JSON.parse(env.DISCORD_ROLE_PERMISSIONS || "{}");
    if (!isRolePermissions(parsed)) throw new Error();
    return [...new Set(roleIds.flatMap((roleId) => parsed[roleId] ?? []))];
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
  if (result.success !== true) {
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

async function controller(env: Env, method: "GET" | "POST", body?: JsonObject) {
  const url = env.RELAY_CONTROLLER_URL || env.STREAM_CONTROLLER_URL;
  const secret = env.RELAY_CONTROLLER_SECRET || env.STREAM_CONTROLLER_SECRET;
  if (!url || !secret) throw new Error("Relay controller is not configured");
  const action = body && "action" in body ? body.action : null;
  const { data: result } = await fetchJson<JsonValue>(url, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    method,
    maxBytes: 256_000,
    name: "Stream controller",
    timeoutMs:
      action === "probe" || action === "restream" || action === "jellyfin" ? 30_000 : 10_000,
  });
  if (!isControllerResponse(result)) throw new Error("Stream controller returned invalid data");
  return result;
}

function streamInfoCacheKey(env: Env) {
  return `stream-info:${env.RELAY_CONTROLLER_URL || env.STREAM_CONTROLLER_URL}:${env.STREAM_URL}`;
}

async function streamInfo(env: Env) {
  const info = await cachedData(streamInfoCacheKey(env), 5, async () => {
    const [relay, upstream] = await Promise.all([
      serializedController(async () => {
        const status = await controller(env, "GET");
        try {
          if (!status.error) env.CINEMA_DIARY?.observe(status.running === true, status.title);
        } catch (error) {
          console.error("Could not update cinema screening", error);
        }
        return status;
      })
        .then((status) => ({
          running: status.running === true,
          title: status.title ?? null,
          jellyfin: status.running ? status.jellyfin : undefined,
        }))
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
  if (!env.CINEMA_DIARY) return info;
  try {
    return { ...info, screening: env.CINEMA_DIARY.current() };
  } catch (error) {
    console.error("Could not read cinema screening", error);
    return info;
  }
}

async function mutateController(env: Env, body: JsonObject) {
  return serializedController(async () => {
    const result = await controller(env, "POST", body);
    try {
      if (!result.error) {
        if (
          ["start", "restream", "jellyfin"].includes(String(body.action)) &&
          result.running === true
        )
          env.CINEMA_DIARY?.start(
            result.title?.trim() || (isString(body.title) ? body.title : null),
          );
        if (body.action === "stop" && result.running === false) env.CINEMA_DIARY?.stop();
      }
    } catch (error) {
      console.error("Could not update cinema screening", error);
    }
    cache.invalidate(streamInfoCacheKey(env));
    return result;
  });
}

function apiError(error: Error | null) {
  return Response.json(
    { error: error?.message ?? "Unexpected request failure" },
    { status: error instanceof ClientError || error instanceof JellyfinError ? error.status : 502 },
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
    const value: JsonValue = await request.json();
    if (!isJsonObject(value)) throw new ClientError("A JSON object is required", 400);
    return value;
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
    "/api/cinema/screening/ticket",
    "/api/admin/movies/add",
    "/api/admin/restream/start",
    "/api/admin/jellyfin/options",
    "/api/admin/jellyfin/start",
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
  if (result.success !== true) throw new Error("Could not create TorBox download URL");
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
    const { data: token, response: tokenResponse } = await fetchJson<{
      access_token?: JsonValue;
    }>("https://discord.com/api/oauth2/token", {
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
    });
    if (!tokenResponse.ok) throw new Error("Discord token exchange failed");
    if (!isString(token.access_token) || !token.access_token)
      throw new Error("Discord token exchange failed");
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const [userResult, memberResult] = await Promise.all([
      fetchJson<JsonValue>("https://discord.com/api/users/@me", {
        headers,
        name: "Discord API",
        requireOk: false,
        timeoutMs: 10_000,
      }),
      fetchJson<JsonValue>(
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

    const user = userResult.data;
    const member = memberResult.data;
    if (!isDiscordUser(user) || !isDiscordMember(member)) {
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
  if (url.pathname === "/api/cinema/tickets" && request.method === "GET") {
    const authorization = await authorizeCostly(request, env, metadata, "cinema-collection", 60);
    if (authorization instanceof Response) return authorization;
    if (!env.CINEMA_DIARY)
      return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    try {
      return Response.json(env.CINEMA_DIARY.collection(authorization.id));
    } catch (error) {
      console.error("Could not read cinema tickets", error);
      return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    }
  }
  if (url.pathname === "/api/cinema/screening" && request.method === "GET") {
    const authorization = await authorizeCostly(
      request,
      env,
      metadata,
      "cinema-admin-read",
      60,
      "stream.manage",
    );
    if (authorization instanceof Response) return authorization;
    if (!env.CINEMA_DIARY)
      return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    try {
      await streamInfo(env);
      return Response.json({ screening: env.CINEMA_DIARY.current() });
    } catch (error) {
      console.error("Could not read cinema screening", error);
      return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    }
  }
  if (url.pathname === "/api/cinema/screening/ticket" && request.method === "POST") {
    const authorization = await authorizeCostly(
      request,
      env,
      metadata,
      "cinema-design",
      10,
      "stream.manage",
    );
    if (authorization instanceof Response) return authorization;
    const diary = env.CINEMA_DIARY;
    if (!diary) return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    try {
      const input = await jsonObject(request);
      if (!isString(input.screeningId) || !input.screeningId || input.screeningId.length > 100)
        throw new ClientError("A current screening is required", 400);
      if (!isString(input.title) || !input.title.trim() || input.title.length > 200)
        throw new ClientError("A ticket title of 1 to 200 characters is required", 400);
      const screeningId = input.screeningId;
      const title = input.title.trim();
      const image = ticketImage(input.image);
      const screening = await serializedController(async () =>
        diary.createTicket(screeningId, title, image),
      );
      if (!screening)
        return Response.json(
          { error: "The screening changed or its ticket was already created" },
          { status: 409 },
        );
      return Response.json({ screening }, { status: 201 });
    } catch (error) {
      if (error instanceof ClientError) return apiError(error);
      console.error("Could not create cinema ticket", error);
      return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    }
  }
  const cinemaImageMatch = url.pathname.match(/^\/api\/cinema\/screenings\/([^/]{1,100})\/image$/);
  if (cinemaImageMatch && request.method === "GET") {
    const authorization = await authorizeCostly(request, env, metadata, "cinema-image", 240);
    if (authorization instanceof Response) return authorization;
    if (!env.CINEMA_DIARY)
      return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    try {
      const image = env.CINEMA_DIARY.image(cinemaImageMatch[1]);
      if (!image) return Response.json({ error: "Ticket image not found" }, { status: 404 });
      return new Response(Uint8Array.from(image.data).buffer, {
        headers: { "Content-Type": image.mimeType, "X-Content-Type-Options": "nosniff" },
      });
    } catch (error) {
      console.error("Could not read cinema ticket image", error);
      return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    }
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
        tmdb<{ results: JsonValue[] }>(
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
      const external = await cachedData(
        `tmdb/movie/${movieId}/external-ids`,
        7 * 24 * 60 * 60,
        () => tmdb<{ imdb_id: string | null }>(`/movie/${movieId}/external_ids`, env),
      );
      if (!external.imdb_id || !/^tt\d+$/.test(external.imdb_id))
        throw new Error("This movie has no IMDb ID");

      const addon = await cachedData(`stremio/movie/${external.imdb_id}`, 30 * 60, async () => {
        const { data } = await fetchJson<JsonValue>(
          `${addonBase(env)}/stream/movie/${external.imdb_id}.json`,
          {
            headers: { Accept: "application/json" },
            maxBytes: 2_000_000,
            name: "Movie addon",
            timeoutMs: 15_000,
          },
        );
        if (!isJsonObject(data) || (data.streams !== undefined && !Array.isArray(data.streams))) {
          throw new Error("Movie addon returned invalid data");
        }
        return { streams: Array.isArray(data.streams) ? data.streams : [] };
      });
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
      const cachedHashes = await cachedData(
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
          timeoutMs: 15_000,
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
      return apiError(error instanceof Error ? error : null);
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
      if (!isInteger(input.torrentId) || !isInteger(input.fileId)) {
        return Response.json({ error: "A valid torrent and file are required" }, { status: 400 });
      }
      const source = await temporaryDownload(env, input.torrentId, input.fileId);
      return Response.json(await controller(env, "POST", { action: "probe", source }));
    } catch (error) {
      return apiError(error instanceof Error ? error : null);
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
      if (!isInteger(input.torrentId) || !isInteger(input.fileId)) {
        return Response.json({ error: "A valid torrent and file are required" }, { status: 400 });
      }
      const source = await temporaryDownload(env, input.torrentId, input.fileId);
      await mutateController(env, {
        action: "start",
        audioIndex: isInteger(input.audioIndex) ? input.audioIndex : 0,
        resolutionIndex: isInteger(input.resolutionIndex) ? input.resolutionIndex : null,
        source,
        subtitleIndex: isInteger(input.subtitleIndex) ? input.subtitleIndex : null,
        title: isString(input.title)
          ? input.title.slice(0, 200) || "TorBox stream"
          : "TorBox stream",
      });
      return Response.json({ detail: "Stream is starting" });
    } catch (error) {
      return apiError(error instanceof Error ? error : null);
    }
  }
  if (
    (url.pathname === "/api/admin/jellyfin/items" && request.method === "GET") ||
    (["/api/admin/jellyfin/options", "/api/admin/jellyfin/start"].includes(url.pathname) &&
      request.method === "POST")
  ) {
    const starting = url.pathname.endsWith("/start");
    const authorization = await authorizeCostly(
      request,
      env,
      metadata,
      starting ? "controller-mutation" : "jellyfin-read",
      starting ? 10 : 60,
      "stream.manage",
    );
    if (authorization instanceof Response) return authorization;
    try {
      if (request.method === "GET")
        return Response.json(await jellyfinLibrary(env, url.searchParams));
      const input = await jsonObject(request);
      if (!starting) return Response.json(await jellyfinOptions(env, jellyfinId(input.itemId)));
      const relay = await jellyfinRelay(env, input);
      const result = await mutateController(env, relay);
      if (result.running !== true) throw new Error("The Jellyfin relay did not start");
      return Response.json({ detail: "Jellyfin stream is starting", title: relay.title });
    } catch (error) {
      return apiError(error instanceof Error ? error : null);
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
        title: result.title?.trim() ? result.title.trim().slice(0, 200) : restream.title,
      });
    } catch (error) {
      if (error instanceof RestreamValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      return apiError(error instanceof Error ? error : null);
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
      return apiError(error instanceof Error ? error : null);
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
      return apiError(error instanceof Error ? error : null);
    }
  }
  if (url.pathname.startsWith("/api/jellyfin/subtitles/") && request.method === "GET") {
    const authorization = await authorizeCostly(request, env, metadata, "jellyfin-subtitles", 90);
    if (authorization instanceof Response) return authorization;
    try {
      const match =
        /^\/api\/jellyfin\/subtitles\/([a-f\d]{32})(?:\/(track|font)\/(\d{1,5}))?$/.exec(
          url.pathname,
        );
      if (!match) throw new JellyfinError("Subtitle not found", 404);
      // Read current controller state, not the stream-info cache: never serve a previous relay's files.
      const status = await serializedController(() => controller(env, "GET"));
      const playback = status.running ? status.jellyfin : null;
      if (!playback || playback.sessionId !== match[1])
        throw new JellyfinError("The stream has changed. Choose subtitles again.", 409);
      const source = await cachedData(
        `jellyfin-subtitles:${env.JELLYFIN_URL}:${playback.sessionId}`,
        60,
        () => jellyfinSubtitleSource(env, playback),
      );
      if (!match[2]) return Response.json({ tracks: source.subtitles, fonts: source.fonts });
      const result = await jellyfinSubtitleFile(
        env,
        playback,
        source,
        match[2] === "font" ? "font" : "track",
        Number(match[3]),
      );
      // Extraction can take time. Do not release an old episode after a concurrent stream change.
      const current = await serializedController(() => controller(env, "GET"));
      if (!current.running || current.jellyfin?.sessionId !== playback.sessionId)
        throw new JellyfinError("The stream has changed. Choose subtitles again.", 409);
      return result;
    } catch (error) {
      return apiError(error instanceof Error ? error : null);
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
