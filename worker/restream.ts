export const restreamQualities = ["best", "1080p", "720p", "480p"] as const;

export type RestreamPlatform = "twitch" | "youtube";
export type RestreamQuality = (typeof restreamQualities)[number];

export type RestreamRequest = {
  platform: RestreamPlatform;
  quality: RestreamQuality;
  source: string;
  title: string;
};

export class RestreamValidationError extends Error {}

const platformHosts: Record<RestreamPlatform, Set<string>> = {
  twitch: new Set(["m.twitch.tv", "twitch.tv", "www.twitch.tv"]),
  youtube: new Set(["m.youtube.com", "www.youtube.com", "youtu.be", "youtube.com"]),
};

function platformForHost(hostname: string) {
  return (Object.entries(platformHosts) as [RestreamPlatform, Set<string>][]).find(([, hosts]) =>
    hosts.has(hostname),
  )?.[0];
}

function fallbackTitle(platform: RestreamPlatform, url: URL) {
  const firstPathPart = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (
    platform === "twitch" &&
    firstPathPart &&
    !["directory", "downloads", "settings", "subscriptions", "turbo", "videos", "wallet"].includes(
      firstPathPart.toLowerCase(),
    )
  ) {
    return firstPathPart;
  }
  if (platform === "youtube" && firstPathPart.startsWith("@")) return firstPathPart;
  return `${platform === "youtube" ? "YouTube" : "Twitch"} restream`;
}

export function parseRestreamRequest(input: Record<string, unknown>): RestreamRequest {
  if (typeof input.source !== "string" || !input.source.trim()) {
    throw new RestreamValidationError("A YouTube or Twitch URL is required");
  }
  const source = input.source.trim();
  if (source.length > 2_048) throw new RestreamValidationError("The stream URL is too long");

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new RestreamValidationError("Enter a valid YouTube or Twitch URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new RestreamValidationError("The stream must use a standard HTTPS URL");
  }

  const platform = platformForHost(url.hostname.toLowerCase());
  if (!platform) throw new RestreamValidationError("Only YouTube and Twitch streams are supported");
  if (url.pathname === "/" || !url.pathname) {
    throw new RestreamValidationError("Enter a URL for a specific stream or channel");
  }

  const quality = input.quality ?? "best";
  if (typeof quality !== "string" || !restreamQualities.includes(quality as RestreamQuality)) {
    throw new RestreamValidationError("Choose a supported stream quality");
  }

  url.hash = "";
  const requestedTitle = typeof input.title === "string" ? input.title.trim().slice(0, 200) : "";
  return {
    platform,
    quality: quality as RestreamQuality,
    source: url.toString(),
    title: requestedTitle || fallbackTitle(platform, url),
  };
}
