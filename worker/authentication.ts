import type { RoomMember } from "../shared/room";
import type { Viewer } from "../shared/user";
import { readCookie, readSession } from "./session";
import { persistentViewer } from "./discord";
import type { Env, RequestMetadata } from "./env";
import { isJsonObject, isStringList, type JsonValue } from "../shared/json";

type DevViewer = Partial<Omit<Viewer, "expires">>;

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

const rateLimits = new Map<
  string,
  {
    count: number;
    started: number;
  }
>();
function isLoopback(address: string | undefined) {
  if (!address) return false;
  const normalized = address.toLowerCase().split("%")[0];
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

export async function viewerForRequest(request: Request, env: Env, metadata?: RequestMetadata) {
  const token = readCookie(request, "bp_session");
  if (token && !token.includes(".")) return persistentViewer(token, env);
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
      expires: Date.now() + 8 * 60 * 60 * 1000,
      id: configured.id ?? "local-dev",
      name: configured.name ?? "Local Bunny",
      permissions: configured.permissions ?? ["admin", "stream.manage", "chloe.chat"],
    } satisfies Viewer;
  } catch {
    throw new Error("DEV_USER_JSON must contain a valid local Viewer object");
  }
}

function rateLimit(viewer: Viewer, bucket: string, limit: number, windowMs = 60000) {
  const key = `${viewer.id}:${bucket}`;
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || now - current.started >= windowMs) {
    if (rateLimits.size > 5000) {
      for (const [entryKey, entry] of rateLimits) {
        if (now - entry.started >= windowMs) rateLimits.delete(entryKey);
      }
    }
    rateLimits.set(key, { count: 1, started: now });
    return null;
  }
  current.count += 1;
  if (current.count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((current.started + windowMs - now) / 1000));
  return Response.json(
    { error: "Too many requests" },
    { headers: { "Retry-After": String(retryAfter) }, status: 429 },
  );
}

export async function authorizeCostly(
  request: Request,
  env: Env,
  metadata: RequestMetadata | undefined,
  bucket: string,
  limit: number,
  permission?: string,
) {
  const viewer = await viewerForRequest(request, env, metadata);
  if (!viewer || (permission && !viewer.admin && !viewer.permissions.includes(permission)))
    return Response.json(
      { error: permission ? "Forbidden" : "Unauthorized" },
      { status: permission ? 403 : 401 },
    );
  return rateLimit(viewer, bucket, limit) ?? viewer;
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
