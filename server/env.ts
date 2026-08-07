import type { Env } from "../worker/index";

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
  const sessionSecret = required(source, "SESSION_SECRET");
  const streamUrl = required(source, "STREAM_URL");
  const controllerUrl = (source.RELAY_CONTROLLER_URL || source.STREAM_CONTROLLER_URL)?.trim();
  const controllerSecret = (
    source.RELAY_CONTROLLER_SECRET || source.STREAM_CONTROLLER_SECRET
  )?.trim();

  for (const name of [
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_GUILD_ID",
    "TORBOX_API_KEY",
  ]) {
    required(source, name);
  }
  if (new TextEncoder().encode(sessionSecret).byteLength < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes");
  }
  if (production && (!controllerUrl || !controllerSecret)) {
    throw new Error("Relay controller URL and secret are required");
  }

  validUrl(appUrl, "APP_URL", production);
  validUrl(streamUrl, "STREAM_URL", production);
  if (controllerUrl) validUrl(controllerUrl, "RELAY_CONTROLLER_URL");
  if (production) validUrl(required(source, "API_URL"), "API_URL", true);
  if (production && source.ENABLE_DEV_AUTH === "true") {
    throw new Error("ENABLE_DEV_AUTH cannot be enabled in production");
  }

  const rolePermissions = source.DISCORD_ROLE_PERMISSIONS?.trim() || "{}";
  try {
    const parsed = JSON.parse(rolePermissions);
    if (
      !parsed ||
      Array.isArray(parsed) ||
      typeof parsed !== "object" ||
      !Object.values(parsed).every(
        (permissions) =>
          Array.isArray(permissions) &&
          permissions.every((permission) => typeof permission === "string"),
      )
    )
      throw new Error();
  } catch {
    throw new Error("DISCORD_ROLE_PERMISSIONS must map role IDs to permission arrays");
  }

  const delay = Number(source.STREAM_DELAY_SECONDS || 6);
  if (!Number.isFinite(delay) || delay < 0 || delay > 120) {
    throw new Error("STREAM_DELAY_SECONDS must be between 0 and 120");
  }

  return {
    ...source,
    ADMIN_DISCORD_IDS: source.ADMIN_DISCORD_IDS || "",
    APP_URL: appUrl,
    DISCORD_ROLE_PERMISSIONS: rolePermissions,
    SESSION_SECRET: sessionSecret,
    STREAM_DELAY_SECONDS: String(delay),
    STREAM_URL: streamUrl,
  } as Env;
}
