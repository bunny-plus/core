import type { Env, RequestMetadata } from "./env";
import { mutationGuard } from "./http";
import { authRoutes } from "./auth-routes";
import { cinemaRoutes } from "./cinema-routes";
import { movieRoutes } from "./movie-routes";
import { streamRoutes } from "./stream-routes";
import { UpstreamError } from "../server/upstream";

const routes = [authRoutes, cinemaRoutes, movieRoutes, streamRoutes];

async function routeRequest(request: Request, env: Env, metadata?: RequestMetadata) {
  const url = new URL(request.url);
  const rejectedMutation = mutationGuard(request, env, url.pathname);
  if (rejectedMutation) return rejectedMutation;
  for (const route of routes) {
    const response = await route(request, env, url, metadata);
    if (response) return response;
  }
  if (url.pathname === "/api/room" && request.method === "GET")
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  return Response.json({ error: "Not found" }, { status: 404 });
}

export async function handleRequest(request: Request, env: Env, metadata?: RequestMetadata) {
  let response: Response;
  try {
    response = await routeRequest(request, env, metadata);
  } catch (error) {
    if (!(error instanceof UpstreamError)) throw error;
    response = Response.json(
      { error: "The session service is temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith("/api/") || pathname.startsWith("/auth/")) {
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}
