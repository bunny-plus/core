import { isRolePermissions, type Viewer } from "../shared/user";
import type { AuthSessions, DiscordCredentials, StoredSession } from "../server/auth-sessions";
import { fetchJson, UpstreamError } from "../server/upstream";
import { isJsonObject, isString, isStringList, type JsonValue } from "../shared/json";
import type { Env } from "./env";

export const discordCheckInterval = 60 * 60 * 1000;
const checks = new WeakMap<AuthSessions, Map<string, Promise<Viewer | null>>>();

type DiscordUser = {
  avatar: string | null;
  global_name: string | null;
  id: string;
  username: string;
};
type DiscordMember = {
  roles: string[];
  pending?: boolean;
};
type DiscordToken = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

class DiscordAccessError extends Error {}

function isDiscordUser(value: JsonValue): value is DiscordUser {
  return (
    isJsonObject(value) &&
    isString(value.id) &&
    isString(value.username) &&
    (value.avatar === null || isString(value.avatar)) &&
    (value.global_name === null || isString(value.global_name))
  );
}

function isDiscordMember(value: JsonValue): value is DiscordMember {
  return (
    isJsonObject(value) &&
    isStringList(value.roles) &&
    (value.pending === undefined || typeof value.pending === "boolean")
  );
}

function isDiscordToken(value: JsonValue): value is DiscordToken {
  return (
    isJsonObject(value) &&
    isString(value.access_token) &&
    value.access_token.length > 0 &&
    isString(value.refresh_token) &&
    value.refresh_token.length > 0 &&
    typeof value.expires_in === "number" &&
    Number.isSafeInteger(value.expires_in) &&
    value.expires_in > 0 &&
    value.expires_in <= 365 * 24 * 60 * 60
  );
}

export async function exchangeDiscordToken(body: URLSearchParams, env: Env) {
  body.set("client_id", env.DISCORD_CLIENT_ID);
  body.set("client_secret", env.DISCORD_CLIENT_SECRET);
  const { data, response } = await fetchJson<JsonValue>("https://discord.com/api/oauth2/token", {
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
    name: "Discord OAuth",
    requireOk: false,
    timeoutMs: 10000,
  });
  if (response.status === 400 && isJsonObject(data) && data.error === "invalid_grant") return null;
  if (!response.ok) throw new UpstreamError("Discord token exchange failed", response.status);
  if (!isDiscordToken(data))
    throw new UpstreamError("Discord token exchange returned invalid data");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  } satisfies DiscordCredentials;
}

export async function discordViewer(accessToken: string, env: Env) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const [userResult, memberResult] = await Promise.all([
    fetchJson<JsonValue>("https://discord.com/api/users/@me", {
      headers,
      name: "Discord API",
      requireOk: false,
      timeoutMs: 10000,
    }),
    fetchJson<JsonValue>(
      `https://discord.com/api/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`,
      { headers, name: "Discord API", requireOk: false, timeoutMs: 10000 },
    ),
  ]);
  if (userResult.response.status === 401 || memberResult.response.status === 401)
    throw new DiscordAccessError();
  if ([403, 404].includes(memberResult.response.status)) return null;
  if (!userResult.response.ok || !memberResult.response.ok)
    throw new UpstreamError("Discord membership could not be checked");
  const user = userResult.data;
  const member = memberResult.data;
  if (!isDiscordUser(user) || !isDiscordMember(member))
    throw new UpstreamError("Discord API returned invalid data");
  if (member.pending) return null;
  return viewerFromDiscord(user, member.roles, env);
}
function viewerFromDiscord(user: DiscordUser, roles: string[], env: Env) {
  const rolePermissions: JsonValue = JSON.parse(env.DISCORD_ROLE_PERMISSIONS || "{}");
  if (!isRolePermissions(rolePermissions))
    throw new Error("DISCORD_ROLE_PERMISSIONS must map Discord role IDs to permission arrays");
  const permissions = [...new Set(roles.flatMap((id) => rolePermissions[id] ?? []))];
  const admins = env.ADMIN_DISCORD_IDS.split(",").map((id) => id.trim());
  const admin = admins.includes(user.id) || permissions.includes("admin");
  if (admin) {
    if (!permissions.includes("stream.manage")) permissions.push("stream.manage");
    if (!permissions.includes("chloe.chat")) permissions.push("chloe.chat");
  }
  return {
    admin,
    avatar: user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128`
      : null,
    id: user.id,
    name: user.global_name ?? user.username,
    permissions,
  } satisfies Omit<Viewer, "expires">;
}
export async function discordBotViewer(userId: string, env: Env) {
  if (!env.DISCORD_BOT_TOKEN) throw new UpstreamError("Discord bot is unavailable");
  const { data, response } = await fetchJson<JsonValue>(
    `https://discord.com/api/v10/guilds/${encodeURIComponent(env.DISCORD_GUILD_ID)}/members/${encodeURIComponent(userId)}`,
    {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
      name: "Discord membership",
      requireOk: false,
      timeoutMs: 10000,
    },
  );
  if (response.status === 404 && isJsonObject(data) && data.code === 10007) return null;
  if (!response.ok)
    throw new UpstreamError("Discord membership could not be checked", response.status);
  const user = isJsonObject(data) ? data.user : undefined;
  if (!isDiscordMember(data) || !user || !isDiscordUser(user) || user.id !== userId)
    throw new UpstreamError("Discord API returned invalid membership data");
  if (data.pending) return null;
  return viewerFromDiscord(user, data.roles, env);
}

async function recheckSession(token: string, stored: StoredSession, store: AuthSessions, env: Env) {
  if (!stored.credentials) {
    const viewer = await discordBotViewer(stored.viewer.id, env);
    if (!viewer) {
      await store.revoke(token);
      return null;
    }
    const result = { ...viewer, expires: stored.viewer.expires };
    return (await store.update(token, result, null)) ? result : null;
  }
  let credentials = stored.credentials;
  async function refresh() {
    return exchangeDiscordToken(
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: credentials.refreshToken }),
      env,
    );
  }
  if (credentials.expiresAt <= Date.now() + 60000) {
    const renewed = await refresh();
    if (!renewed) {
      await store.revoke(token);
      return null;
    }
    credentials = renewed;
    // Keep rotated credentials even if the subsequent Discord API request fails.
    if (!(await store.update(token, stored.viewer, credentials, stored.checkedAt))) return null;
  }
  let viewer: Omit<Viewer, "expires"> | null;
  try {
    viewer = await discordViewer(credentials.accessToken, env);
  } catch (error) {
    if (!(error instanceof DiscordAccessError)) throw error;
    const renewed = await refresh();
    if (!renewed) {
      await store.revoke(token);
      return null;
    }
    credentials = renewed;
    if (!(await store.update(token, stored.viewer, credentials, stored.checkedAt))) return null;
    try {
      viewer = await discordViewer(credentials.accessToken, env);
    } catch (retryError) {
      if (!(retryError instanceof DiscordAccessError)) throw retryError;
      viewer = null;
    }
  }
  if (!viewer || viewer.id !== stored.viewer.id) {
    await store.revoke(token);
    return null;
  }
  const result = { ...viewer, expires: stored.viewer.expires };
  return (await store.update(token, result, credentials)) ? result : null;
}

export async function persistentViewer(token: string, env: Env): Promise<Viewer | null> {
  const store = env.AUTH_SESSIONS;
  if (!store) return null;
  const stored = await store.read(token);
  if (!stored) return null;
  if (Date.now() - stored.checkedAt < discordCheckInterval) return stored.viewer;
  let pending = checks.get(store);
  if (!pending) {
    pending = new Map();
    checks.set(store, pending);
  }
  const existing = pending.get(token);
  if (existing) return existing;
  const check = recheckSession(token, stored, store, env).finally(() => pending.delete(token));
  pending.set(token, check);
  return check;
}
