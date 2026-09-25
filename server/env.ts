import type { Env } from "../worker/index";
import { jellyfinBaseUrl } from "./jellyfin";

type JsonObject = { [key: string]: JsonValue };
type JsonValue = boolean | JsonObject | JsonValue[] | null | number | string;
type RolePermissions = { [roleId: string]: string[] };

function isString(value: JsonValue): value is string {
  return typeof value === "string";
}

function isStringList(value: JsonValue): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isRolePermissions(value: JsonValue): value is RolePermissions {
  return (
    value !== null &&
    !Array.isArray(value) &&
    typeof value === "object" &&
    Object.values(value).every(isStringList)
  );
}

function required(source: NodeJS.ProcessEnv, name: string) {
  const value = source[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validUrl(value: string, name: string, requireHttps = false) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (requireHttps ? url.protocol !== "https:" : !["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${name} must use ${requireHttps ? "HTTPS" : "HTTP or HTTPS"}`);
  }
}

export function loadEnvironment(source: NodeJS.ProcessEnv): Env {
  const production = source.NODE_ENV === "production";
  const appUrl = required(source, "APP_URL");
  const discordClientId = required(source, "DISCORD_CLIENT_ID");
  const discordClientSecret = required(source, "DISCORD_CLIENT_SECRET");
  const discordGuildId = required(source, "DISCORD_GUILD_ID");
  const sessionSecret = required(source, "SESSION_SECRET");
  const streamUrl = required(source, "STREAM_URL");
  const torBoxApiKey = required(source, "TORBOX_API_KEY");
  const controllerUrl = (source.RELAY_CONTROLLER_URL || source.STREAM_CONTROLLER_URL)?.trim();
  const controllerSecret = (
    source.RELAY_CONTROLLER_SECRET || source.STREAM_CONTROLLER_SECRET
  )?.trim();

  if (new TextEncoder().encode(sessionSecret).byteLength < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes");
  }
  if (production && (!controllerUrl || !controllerSecret)) {
    throw new Error("Relay controller URL and secret are required");
  }

  validUrl(appUrl, "APP_URL", production);
  validUrl(streamUrl, "STREAM_URL", production);
  if (controllerUrl) validUrl(controllerUrl, "RELAY_CONTROLLER_URL");
  const jellyfinUrl = source.JELLYFIN_URL?.trim();
  const jellyfinApiKey = source.JELLYFIN_API_KEY?.trim();
  if (jellyfinUrl) jellyfinBaseUrl(jellyfinUrl);
  if (jellyfinApiKey && !/^[a-z\d_-]{16,512}$/i.test(jellyfinApiKey))
    throw new Error("JELLYFIN_API_KEY must be a valid API token");
  if (jellyfinApiKey && !jellyfinUrl)
    throw new Error("JELLYFIN_URL is required when JELLYFIN_API_KEY is set");
  if (production) validUrl(required(source, "API_URL"), "API_URL", true);
  if (production && source.ENABLE_DEV_AUTH === "true") {
    throw new Error("ENABLE_DEV_AUTH cannot be enabled in production");
  }

  const rolePermissions = source.DISCORD_ROLE_PERMISSIONS?.trim() || "{}";
  try {
    const parsed: JsonValue = JSON.parse(rolePermissions);
    if (!isRolePermissions(parsed)) throw new Error();
  } catch {
    throw new Error("DISCORD_ROLE_PERMISSIONS must map role IDs to permission arrays");
  }

  const delay = Number(source.STREAM_DELAY_SECONDS || 6);
  if (!Number.isFinite(delay) || delay < 0 || delay > 120) {
    throw new Error("STREAM_DELAY_SECONDS must be between 0 and 120");
  }

  return {
    ADMIN_DISCORD_IDS: source.ADMIN_DISCORD_IDS || "",
    APP_VERSION: source.APP_VERSION,
    APP_URL: appUrl,
    API_URL: source.API_URL,
    CHAT_DB_PATH: source.CHAT_DB_PATH,
    DEV_USER_JSON: source.DEV_USER_JSON,
    DISCORD_CLIENT_ID: discordClientId,
    DISCORD_CLIENT_SECRET: discordClientSecret,
    DISCORD_GUILD_ID: discordGuildId,
    DISCORD_ROLE_PERMISSIONS: rolePermissions,
    ENABLE_DEV_AUTH: source.ENABLE_DEV_AUTH,
    JELLYFIN_URL: jellyfinUrl,
    JELLYFIN_API_KEY: jellyfinApiKey,
    NODE_ENV: source.NODE_ENV,
    RELAY_CONTROLLER_SECRET: source.RELAY_CONTROLLER_SECRET,
    RELAY_CONTROLLER_URL: source.RELAY_CONTROLLER_URL,
    SESSION_SECRET: sessionSecret,
    STREAM_CONTROLLER_SECRET: source.STREAM_CONTROLLER_SECRET,
    STREAM_CONTROLLER_URL: source.STREAM_CONTROLLER_URL,
    STREAM_DELAY_SECONDS: String(delay),
    STREAM_URL: streamUrl,
    STREMIO_ADDON_URL: source.STREMIO_ADDON_URL,
    TMDB_API_TOKEN: source.TMDB_API_TOKEN,
    TORBOX_API_KEY: torBoxApiKey,
  };
}
