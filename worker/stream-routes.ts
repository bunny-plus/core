import type { Env, RequestMetadata } from "./env";
import { authorizeCostly } from "./authentication";
import { apiError, jsonObject } from "./http";
import { controller, mutateController, streamInfo } from "./stream-controller";
import { torBox, temporaryDownload, type TorBoxTorrent } from "./torbox";
import { parseRestreamRequest, RestreamValidationError } from "./restream";
import { streamPlayback } from "../server/stream-playback";
import { jellyfinLibrary, jellyfinOptions, jellyfinId, jellyfinRelay } from "../server/jellyfin";
import { isInteger, isString } from "../shared/json";

export async function streamRoutes(
  request: Request,
  env: Env,
  url: URL,
  metadata?: RequestMetadata,
) {
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
  if (url.pathname === "/api/stream-playback" && request.method === "POST") {
    const authorization = await authorizeCostly(request, env, metadata, "stream-playback", 60);
    if (authorization instanceof Response) return authorization;
    try {
      await jsonObject(request);
      return Response.json(await streamPlayback(env), {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (error) {
      return apiError(error instanceof Error ? error : null);
    }
  }
  if (url.pathname === "/api/stream-info" && request.method === "GET") {
    const authorization = await authorizeCostly(request, env, metadata, "stream-info", 60);
    if (authorization instanceof Response) return authorization;
    return Response.json(await streamInfo(env), { headers: { "Cache-Control": "no-store" } });
  }
  return null;
}
