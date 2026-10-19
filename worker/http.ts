import type { Env } from "./env";
import { JellyfinError } from "../server/jellyfin";
import { isJsonObject, type JsonValue } from "../shared/json";

export class ClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function isSecure(request: Request) {
  return new URL(request.url).protocol === "https:";
}

export function apiError(error: Error | null) {
  return Response.json(
    { error: error?.message ?? "Unexpected request failure" },
    { status: error instanceof ClientError || error instanceof JellyfinError ? error.status : 502 },
  );
}
export async function jsonObject(request: Request) {
  try {
    const value: JsonValue = await request.json();
    if (!isJsonObject(value)) throw new ClientError("A JSON object is required", 400);
    return value;
  } catch (error) {
    if (error instanceof ClientError) throw error;
    throw new ClientError("Malformed JSON", 400);
  }
}

const jsonRoutes = new Set([
  "/api/stream-playback",
  "/api/stream-playback/stop",
  "/api/login/discord",
  "/api/cinema/screening/ticket",
  "/api/cinema/screening/counting",
  "/api/admin/movies/add",
  "/api/admin/restream/start",
  "/api/admin/jellyfin/options",
  "/api/admin/jellyfin/start",
  "/api/admin/torbox/options",
  "/api/admin/torbox/start",
]);

export function mutationGuard(request: Request, env: Env, pathname: string) {
  if (!pathname.startsWith("/api/") || ["GET", "HEAD", "OPTIONS"].includes(request.method))
    return null;
  if (request.headers.get("Origin") !== new URL(env.APP_URL).origin) {
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  }
  if (
    jsonRoutes.has(pathname) &&
    request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/json"
  ) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}
