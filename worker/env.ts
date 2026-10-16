import type { AuthSessions } from "../server/auth-sessions";
import type { CinemaDiary } from "../server/cinema";

export interface Env {
  ADMIN_DISCORD_IDS: string;
  APP_VERSION?: string;
  APP_URL: string;
  API_URL?: string;
  AUTH_SESSIONS?: AuthSessions;
  CHAT_DB_PATH?: string;
  CINEMA_DIARY?: CinemaDiary;
  CLOUDFLARE_STREAM_SIGNING_KEY_ID?: string;
  CLOUDFLARE_STREAM_SIGNING_KEY_JWK?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_GUILD_ID: string;
  DISCORD_ROLE_PERMISSIONS: string;
  DEV_USER_JSON?: string;
  D1_DATABASE_URL?: string;
  D1_DATABASE_SECRET?: string;
  ENABLE_DEV_AUTH?: string;
  JELLYFIN_URL?: string;
  JELLYFIN_STREAM_URL?: string;
  JELLYFIN_API_KEY?: string;
  NODE_ENV?: string;
  SESSION_SECRET: string;
  RELAY_CONTROLLER_SECRET?: string;
  RELAY_CONTROLLER_URL?: string;
  STREAM_URL: string;
  STREMIO_ADDON_URL?: string;
  TMDB_API_TOKEN?: string;
  TORBOX_API_KEY: string;
}

export type RequestMetadata = {
  peerAddress?: string;
};
