import type { Env } from "../worker/env";
import type {
  JellyfinItem,
  JellyfinLibrary,
  JellyfinOptions,
  JellyfinSource,
  JellyfinPlayback,
} from "../shared/jellyfin";
import { fetchJson, UpstreamError } from "./upstream";
import { isJsonObject, isString, type JsonObject, type JsonValue } from "../shared/json";

export class JellyfinError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
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

async function jellyfinGet(env: Env, path: string, query: URLSearchParams, timeoutMs = 15_000) {
  const config = configuration(env);
  try {
    const { data } = await fetchJson<JsonValue>(`${config.url}/${path}?${query}`, {
      headers: {
        Authorization: `MediaBrowser Token="${config.token}"`,
        Accept: "application/json",
      },
      name: "Jellyfin",
      timeoutMs,
      maxBytes: 2_000_000,
      redirect: "error",
    });
    if (!isJsonObject(data)) throw new Error("Jellyfin returned invalid data");
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
  if (!isJsonObject(item) || !isString(item.Id) || !isString(item.Name))
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
  if (parentId) {
    const parent = await jellyfinItem(env, jellyfinId(parentId, "parentId"));
    if (parent.Type !== "Series" && parent.Type !== "Season")
      throw new JellyfinError("Choose a Jellyfin show or season", 400);
    const seriesId = jellyfinId(parent.Type === "Series" ? parent.Id : parent.SeriesId);
    const seasons = parent.Type === "Series" && !search;
    const params = new URLSearchParams({
      EnableImages: "false",
      EnableUserData: "false",
      IsMissing: "false",
    });
    if (parent.Type === "Season") params.set("SeasonId", parentId);
    if (!seasons && !search) {
      params.set("StartIndex", String(startIndex));
      params.set("Limit", String(limit));
    }
    const data = await jellyfinGet(
      env,
      `Shows/${seriesId}/${seasons ? "Seasons" : "Episodes"}`,
      params,
    );
    if (!Array.isArray(data.Items) || !isIndex(data.TotalRecordCount))
      throw new Error("Jellyfin returned an invalid library");
    let items = data.Items.map(itemFromJson);
    if (seasons || search) {
      if (search) {
        const term = search.toLocaleLowerCase();
        items = items.filter((item) => item.title.toLocaleLowerCase().includes(term));
      }
      return {
        items: items.slice(startIndex, startIndex + limit),
        total: items.length,
        startIndex,
        limit,
      };
    }
    return { items, total: data.TotalRecordCount, startIndex, limit };
  }
  const params = new URLSearchParams({
    IncludeItemTypes: search ? "Movie,Series,Episode" : "Movie,Series",
    Recursive: "true",
    SortBy: "SortName",
    SortOrder: "Ascending",
    StartIndex: String(startIndex),
    Limit: String(limit),
    EnableImages: "false",
    EnableUserData: "false",
    IsMissing: "false",
  });
  if (search) params.set("SearchTerm", search);
  const data = await jellyfinGet(env, "Items", params);
  if (!Array.isArray(data.Items) || !isIndex(data.TotalRecordCount))
    throw new Error("Jellyfin returned an invalid library");
  return { items: data.Items.map(itemFromJson), total: data.TotalRecordCount, startIndex, limit };
}

async function jellyfinItem(env: Env, itemId: string, fields = "") {
  const data = await jellyfinGet(
    env,
    "Items",
    new URLSearchParams({
      Ids: itemId,
      Fields: fields,
      EnableImages: "false",
      EnableUserData: "false",
    }),
  );
  if (!Array.isArray(data.Items) || data.Items.length !== 1 || !isJsonObject(data.Items[0]))
    throw new JellyfinError("This Jellyfin item is no longer available", 404);
  return data.Items[0];
}

function sourceFromJson(source: JsonValue): JellyfinSource | null {
  if (
    !isJsonObject(source) ||
    !isString(source.Id) ||
    source.Protocol !== "File" ||
    source.RequiresOpening === true ||
    !Array.isArray(source.MediaStreams)
  )
    return null;
  const streams = source.MediaStreams.filter(isJsonObject);
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
  const subtitles = streams
    .filter((stream) => stream.Type === "Subtitle" && isIndex(stream.Index))
    .map((stream) => ({
      // SAFETY: The filter requires a non-negative integer stream index.
      index: stream.Index as number,
      label: isString(stream.DisplayTitle) ? stream.DisplayTitle : `Subtitle ${stream.Index}`,
      language: isString(stream.Language) ? stream.Language : null,
      supported:
        isString(stream.Codec) &&
        ["ass", "ssa", "srt", "subrip", "webvtt", "vtt", "mov_text", "text", "ttml"].includes(
          stream.Codec.toLowerCase(),
        ),
    }));
  const preferredSubtitle =
    subtitles.find(
      (track) => track.supported && track.index === source.DefaultSubtitleStreamIndex,
    ) ?? subtitles.find((track) => track.supported);
  return {
    id: source.Id,
    name: isString(source.Name) ? source.Name : "Original file",
    audio,
    subtitles,
    fonts: Array.isArray(source.MediaAttachments)
      ? source.MediaAttachments.filter(isJsonObject)
          .filter(
            (attachment) =>
              isIndex(attachment.Index) &&
              isString(attachment.FileName) &&
              /\.(ttf|otf|woff2?)$/i.test(attachment.FileName),
          )
          .slice(0, 16)
          .map((attachment) => {
            // SAFETY: The filter requires a non-negative integer attachment index.
            return attachment.Index as number;
          })
      : [],
    defaultAudioIndex: preferred?.index ?? null,
    defaultSubtitleIndex: preferredSubtitle?.index ?? null,
    height: isNumber(video.Height) ? video.Height : null,
    hdrTransfer:
      video.ColorTransfer === "smpte2084" || video.ColorTransfer === "arib-std-b67"
        ? video.ColorTransfer
        : null,
  };
}

export function isJellyfinPlayback(value: JsonValue | undefined): value is JellyfinPlayback {
  return (
    isJsonObject(value) &&
    isString(value.sessionId) &&
    /^[a-f\d]{32}$/.test(value.sessionId) &&
    isString(value.itemId) &&
    /^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(value.itemId) &&
    isString(value.mediaSourceId) &&
    /^[\w-]{1,200}$/.test(value.mediaSourceId) &&
    (value.subtitleIndex == null || isIndex(value.subtitleIndex)) &&
    (value.subtitlesBurnedIn === undefined || typeof value.subtitlesBurnedIn === "boolean") &&
    (value.startedAt === null || (isNumber(value.startedAt) && value.startedAt > 0))
  );
}

export async function jellyfinRuntime(
  env: Env,
  playback: JellyfinPlayback,
): Promise<number | null> {
  const data = await jellyfinGet(
    env,
    "Items",
    new URLSearchParams({
      Ids: jellyfinId(playback.itemId),
      Fields: "MediaSources",
      EnableImages: "false",
      EnableUserData: "false",
    }),
    3_000,
  );
  const item = Array.isArray(data.Items) ? data.Items.find(isJsonObject) : undefined;
  if (!item) return null;
  const version = Array.isArray(item.MediaSources)
    ? item.MediaSources.filter(isJsonObject).find((source) => source.Id === playback.mediaSourceId)
    : undefined;
  const ticks =
    isNumber(version?.RunTimeTicks) && version.RunTimeTicks > 0
      ? version.RunTimeTicks
      : item.RunTimeTicks;
  return isNumber(ticks) && ticks >= 10_000_000 ? Math.round(ticks / 10_000_000) : null;
}

export async function jellyfinOptions(env: Env, id: string): Promise<JellyfinOptions> {
  const itemId = jellyfinId(id);
  const raw = await jellyfinItem(env, itemId, "MediaSources,MediaStreams");
  const item = itemFromJson(raw);
  if (item.kind !== "Movie" && item.kind !== "Episode")
    throw new JellyfinError("Choose a movie or episode to stream", 400);
  if (!isJsonObject(raw) || !Array.isArray(raw.MediaSources))
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
  if (input.subtitleIndex != null && !isIndex(input.subtitleIndex))
    throw new JellyfinError("Invalid subtitle track", 400);
  const options = await jellyfinOptions(env, itemId);
  const source = options.sources.find((entry) => entry.id === input.mediaSourceId);
  if (!source)
    throw new JellyfinError("The selected Jellyfin media version is no longer available", 400);
  if (audioIndex !== null && !source.audio.some((track) => track.index === audioIndex))
    throw new JellyfinError("The selected audio track is no longer available", 400);
  const subtitleIndex =
    input.subtitleIndex === undefined ? source.defaultSubtitleIndex : input.subtitleIndex;
  if (
    subtitleIndex !== null &&
    !source.subtitles.some((track) => track.index === subtitleIndex && track.supported)
  )
    throw new JellyfinError("The selected subtitle track is unavailable or unsupported", 400);
  const config = configuration(env);
  const params = new URLSearchParams({ Static: "true", MediaSourceId: source.id });
  return {
    action: "jellyfin",
    source: `${env.JELLYFIN_STREAM_URL ? jellyfinBaseUrl(env.JELLYFIN_STREAM_URL) : config.url}/Videos/${itemId}/stream?${params}`,
    apiKey: config.token,
    audioIndex: audioIndex ?? source.defaultAudioIndex,
    subtitleIndex,
    subtitleFonts: subtitleIndex === null ? [] : source.fonts,
    resolutionIndex,
    hdrTransfer: source.hdrTransfer,
    title: options.item.title.slice(0, 200),
  };
}
