import type { Env } from "../worker/index";
import type {
  JellyfinItem,
  JellyfinLibrary,
  JellyfinOptions,
  JellyfinSource,
} from "../shared/jellyfin";
import { fetchJson, UpstreamError, type JsonObject, type JsonValue } from "./upstream";

export class JellyfinError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIndex(value: JsonValue | undefined): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 0;
}

export function jellyfinBaseUrl(value: string) {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /\/web(?:\/|$)/i.test(url.pathname)
  ) {
    throw new Error(
      "JELLYFIN_URL must be an HTTP or HTTPS server URL including its base path, without /web, credentials, a query, or a fragment",
    );
  }
  return url.toString().replace(/\/$/, "");
}

function configuration(env: Env) {
  if (!env.JELLYFIN_URL || !env.JELLYFIN_API_KEY) {
    throw new JellyfinError(
      "Jellyfin is not connected yet. Configure its server URL and API key on the backend.",
      503,
    );
  }
  return { url: jellyfinBaseUrl(env.JELLYFIN_URL), token: env.JELLYFIN_API_KEY };
}

export function jellyfinId(value: JsonValue | undefined, name = "itemId") {
  if (
    !isString(value) ||
    !/^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(value)
  ) {
    throw new JellyfinError(`A valid Jellyfin ${name} is required`, 400);
  }
  return value;
}

async function jellyfinGet(env: Env, path: string, query: URLSearchParams) {
  const config = configuration(env);
  try {
    const { data } = await fetchJson<JsonValue>(`${config.url}/${path}?${query}`, {
      headers: {
        Authorization: `MediaBrowser Token="${config.token}"`,
        Accept: "application/json",
      },
      name: "Jellyfin",
      timeoutMs: 15_000,
      maxBytes: 2_000_000,
      redirect: "error",
    });
    if (!isObject(data)) throw new Error("Jellyfin returned invalid data");
    return data;
  } catch (error) {
    if (error instanceof UpstreamError && [401, 403].includes(error.status ?? 0)) {
      throw new JellyfinError(
        "Jellyfin rejected the configured API key. Check its access on the server.",
        502,
      );
    }
    throw error;
  }
}

function itemFromJson(item: JsonValue): JellyfinItem {
  if (!isObject(item) || !isString(item.Id) || !isString(item.Name))
    throw new Error("Jellyfin returned an invalid library item");
  const kind = item.Type;
  if (kind !== "Movie" && kind !== "Series" && kind !== "Season" && kind !== "Episode") {
    throw new JellyfinError("Choose a movie or episode from Jellyfin", 400);
  }
  let title = item.Name;
  if (kind === "Episode") {
    const episode = [
      isIndex(item.ParentIndexNumber) ? `S${String(item.ParentIndexNumber).padStart(2, "0")}` : "",
      isIndex(item.IndexNumber) ? `E${String(item.IndexNumber).padStart(2, "0")}` : "",
    ].join("");
    title = [isString(item.SeriesName) ? item.SeriesName : "", episode, item.Name]
      .filter(Boolean)
      .join(" · ");
  }
  return {
    id: jellyfinId(item.Id),
    name: item.Name,
    title,
    kind,
    year: isNumber(item.ProductionYear) ? item.ProductionYear : null,
    minutes: isNumber(item.RunTimeTicks) ? Math.round(item.RunTimeTicks / 600_000_000) : null,
  };
}

export async function jellyfinLibrary(env: Env, query: URLSearchParams): Promise<JellyfinLibrary> {
  const search = query.get("query")?.trim() ?? "";
  const parentId = query.get("parentId");
  const startIndex = Number(query.get("startIndex") ?? 0);
  if (
    search.length > 200 ||
    !Number.isSafeInteger(startIndex) ||
    startIndex < 0 ||
    startIndex > 1_000_000
  ) {
    throw new JellyfinError("Invalid Jellyfin search or page", 400);
  }
  const limit = 40;
  const params = new URLSearchParams({
    IncludeItemTypes: parentId
      ? "Season,Episode"
      : search
        ? "Movie,Series,Episode"
        : "Movie,Series",
    Recursive: parentId && !search ? "false" : "true",
    SortBy: parentId ? "ParentIndexNumber,IndexNumber,SortName" : "SortName",
    SortOrder: "Ascending",
    StartIndex: String(startIndex),
    Limit: String(limit),
    EnableImages: "false",
    EnableUserData: "false",
    IsMissing: "false",
  });
  if (parentId) params.set("ParentId", jellyfinId(parentId, "parentId"));
  if (search) params.set("SearchTerm", search);
  const data = await jellyfinGet(env, "Items", params);
  if (!Array.isArray(data.Items) || !isIndex(data.TotalRecordCount))
    throw new Error("Jellyfin returned an invalid library");
  return { items: data.Items.map(itemFromJson), total: data.TotalRecordCount, startIndex, limit };
}

function sourceFromJson(source: JsonValue): JellyfinSource | null {
  if (
    !isObject(source) ||
    !isString(source.Id) ||
    source.Protocol !== "File" ||
    source.RequiresOpening === true ||
    !Array.isArray(source.MediaStreams)
  )
    return null;
  const streams = source.MediaStreams.filter(isObject);
  const video = streams.find((stream) => stream.Type === "Video" && stream.IsAttachedPic !== true);
  if (!video) return null;
  const audio = streams
    .filter((stream) => stream.Type === "Audio" && isIndex(stream.Index))
    .map((stream) => ({
      // SAFETY: The filter above requires a non-negative integer stream index.
      index: stream.Index as number,
      label: isString(stream.DisplayTitle)
        ? stream.DisplayTitle
        : [stream.Language, stream.Codec, isNumber(stream.Channels) ? `${stream.Channels}ch` : null]
            .filter(isString)
            .join(" · ") || `Track ${stream.Index}`,
      default: stream.IsDefault === true,
    }));
  const preferred =
    audio.find((track) => track.index === source.DefaultAudioStreamIndex) ??
    audio.find((track) => track.default) ??
    audio[0];
  return {
    id: source.Id,
    name: isString(source.Name) ? source.Name : "Original file",
    audio,
    defaultAudioIndex: preferred?.index ?? null,
    height: isNumber(video.Height) ? video.Height : null,
  };
}

export async function jellyfinOptions(env: Env, id: string): Promise<JellyfinOptions> {
  const itemId = jellyfinId(id);
  const data = await jellyfinGet(
    env,
    "Items",
    new URLSearchParams({
      Ids: itemId,
      Fields: "MediaSources,MediaStreams",
      EnableImages: "false",
      EnableUserData: "false",
    }),
  );
  if (!Array.isArray(data.Items) || data.Items.length !== 1)
    throw new JellyfinError("This Jellyfin item is no longer available", 404);
  const raw = data.Items[0];
  const item = itemFromJson(raw);
  if (item.kind !== "Movie" && item.kind !== "Episode")
    throw new JellyfinError("Choose a movie or episode to stream", 400);
  if (!isObject(raw) || !Array.isArray(raw.MediaSources))
    throw new Error("Jellyfin returned no media sources");
  const sources = raw.MediaSources.map(sourceFromJson).filter((source) => source !== null);
  if (!sources.length)
    throw new JellyfinError(
      "This item has no available video file. Live TV and remote media are not supported.",
      400,
    );
  return { item, sources };
}

export async function jellyfinRelay(env: Env, input: JsonObject) {
  const itemId = jellyfinId(input.itemId);
  if (!isString(input.mediaSourceId) || input.mediaSourceId.length > 200)
    throw new JellyfinError("Choose a Jellyfin media version", 400);
  const audioIndex = input.audioIndex ?? null;
  const resolutionIndex = input.resolutionIndex ?? null;
  if (
    (audioIndex !== null && !isIndex(audioIndex)) ||
    (resolutionIndex !== null && (!isIndex(resolutionIndex) || resolutionIndex > 7))
  )
    throw new JellyfinError("Invalid audio track or resolution", 400);
  if (input.subtitleIndex != null)
    throw new JellyfinError("Jellyfin relay subtitles are not supported", 400);
  const options = await jellyfinOptions(env, itemId);
  const source = options.sources.find((entry) => entry.id === input.mediaSourceId);
  if (!source)
    throw new JellyfinError("The selected Jellyfin media version is no longer available", 400);
  if (audioIndex !== null && !source.audio.some((track) => track.index === audioIndex))
    throw new JellyfinError("The selected audio track is no longer available", 400);
  const config = configuration(env);
  const params = new URLSearchParams({ Static: "true", MediaSourceId: source.id });
  return {
    action: "jellyfin",
    source: `${env.JELLYFIN_STREAM_URL ? jellyfinBaseUrl(env.JELLYFIN_STREAM_URL) : config.url}/Videos/${itemId}/stream?${params}`,
    apiKey: config.token,
    audioIndex: audioIndex ?? source.defaultAudioIndex,
    resolutionIndex,
    title: options.item.title.slice(0, 200),
  };
}
