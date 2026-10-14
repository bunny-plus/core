import { createHash, randomBytes } from "node:crypto";
import { AppDatabase, SqliteDatabase, query } from "./database";

import type { Viewer } from "../shared/user";
import { isViewer, sessionLifetimeSeconds } from "../worker/session";
import type { JsonValue } from "../shared/json";

export type DiscordCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type StoredSession = {
  viewer: Viewer;
  // Bot sign-ins recheck membership with the backend token instead of user OAuth credentials.
  credentials: DiscordCredentials | null;
  checkedAt: number;
};

type SessionRow = {
  auth_method: string;
  viewer_json: string;
  access_token: string;
  refresh_token: string;
  access_expires_at: number;
  checked_at: number;
  expires_at: number;
};

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export const discordLoginLifetimeMs = 10 * 60 * 1_000;

function isToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export class AuthSessions {
  private readonly database: AppDatabase;
  readonly ready: Promise<void>;

  constructor(file: string | AppDatabase) {
    this.database = file instanceof AppDatabase ? file : new SqliteDatabase(file);
    this.ready = this.initialize();
  }

  private async initialize() {
    await this.database.exec(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        viewer_json TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        access_expires_at INTEGER NOT NULL,
        checked_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        auth_method TEXT NOT NULL DEFAULT 'oauth'
      ) STRICT;
      CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS discord_login_links (
        token_hash TEXT PRIMARY KEY,
        discord_user_id TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS discord_login_links_expiry ON discord_login_links(expires_at);
    `);
    const columns = await this.database
      .prepare("PRAGMA table_info(auth_sessions)")
      .all<{ name: string }>();
    if (!columns.some((column) => column.name === "auth_method")) {
      await this.database.exec(
        "ALTER TABLE auth_sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'oauth'",
      );
    }
  }

  private sessionInsert(
    token: string,
    viewer: Omit<Viewer, "expires">,
    credentials: DiscordCredentials | null,
    now: number,
  ) {
    return query(
      `
      INSERT INTO auth_sessions (
        token_hash, viewer_json, access_token, refresh_token, access_expires_at, checked_at, expires_at, auth_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      tokenHash(token),
      JSON.stringify({ ...viewer, expires: now + sessionLifetimeSeconds * 1_000 }),
      credentials?.accessToken ?? "",
      credentials?.refreshToken ?? "",
      credentials?.expiresAt ?? 0,
      now,
      now + sessionLifetimeSeconds * 1_000,
      credentials ? "oauth" : "bot",
    );
  }

  async create(
    viewer: Omit<Viewer, "expires">,
    credentials: DiscordCredentials | null,
    now = Date.now(),
  ) {
    await this.ready;
    const token = randomBytes(32).toString("base64url");
    await this.database.batch([
      query("DELETE FROM auth_sessions WHERE expires_at <= ?", now),
      this.sessionInsert(token, viewer, credentials, now),
    ]);
    return token;
  }

  async read(token: string, now = Date.now()): Promise<StoredSession | null> {
    await this.ready;
    if (!isToken(token)) return null;
    // SAFETY: The query selects these exact columns from the STRICT schema above.
    const row = await this.database
      .prepare("SELECT * FROM auth_sessions WHERE token_hash = ? AND expires_at > ?")
      .get<SessionRow>(tokenHash(token), now);
    if (!row) return null;
    const viewer: JsonValue = JSON.parse(row.viewer_json);
    if (!isViewer(viewer)) return null;
    return {
      viewer: { ...viewer, expires: row.expires_at },
      credentials:
        row.auth_method === "bot"
          ? null
          : {
              accessToken: row.access_token,
              refreshToken: row.refresh_token,
              expiresAt: row.access_expires_at,
            },
      checkedAt: row.checked_at,
    };
  }

  async update(
    token: string,
    viewer: Viewer,
    credentials: DiscordCredentials | null,
    checkedAt = Date.now(),
  ) {
    await this.ready;
    return (
      (
        await this.database
          .prepare(`
          UPDATE auth_sessions SET viewer_json = ?, access_token = ?, refresh_token = ?,
            access_expires_at = ?, checked_at = ?, auth_method = ?
          WHERE token_hash = ? AND expires_at > ?
        `)
          .run(
            JSON.stringify(viewer),
            credentials?.accessToken ?? "",
            credentials?.refreshToken ?? "",
            credentials?.expiresAt ?? 0,
            checkedAt,
            credentials ? "oauth" : "bot",
            tokenHash(token),
            Date.now(),
          )
      ).changes > 0
    );
  }

  async renew(token: string, now = Date.now()) {
    await this.ready;
    return (
      (
        await this.database
          .prepare(
            "UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ? AND expires_at > ?",
          )
          .run(now + sessionLifetimeSeconds * 1_000, tokenHash(token), now)
      ).changes > 0
    );
  }

  async revoke(token: string) {
    await this.ready;
    await this.database
      .prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
      .run(tokenHash(token));
  }

  async issueLoginLink(userId: string, now = Date.now()) {
    await this.ready;
    const token = randomBytes(32).toString("base64url");
    await this.database.batch([
      query("DELETE FROM discord_login_links WHERE expires_at <= ?", now),
      query(
        `
        INSERT INTO discord_login_links (token_hash, discord_user_id, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(discord_user_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at
      `,
        tokenHash(token),
        userId,
        now + discordLoginLifetimeMs,
      ),
    ]);
    return token;
  }

  async loginUser(token: string, now = Date.now()) {
    await this.ready;
    if (!isToken(token)) return null;
    const row = await this.database
      .prepare(
        "SELECT discord_user_id FROM discord_login_links WHERE token_hash = ? AND expires_at > ?",
      )
      .get<{ discord_user_id: string }>(tokenHash(token), now);
    return row?.discord_user_id ?? null;
  }

  async revokeLoginLink(token: string) {
    await this.ready;
    await this.database
      .prepare("DELETE FROM discord_login_links WHERE token_hash = ?")
      .run(tokenHash(token));
  }

  async redeemLoginLink(token: string, viewer: Omit<Viewer, "expires">, now = Date.now()) {
    await this.ready;
    if (!isToken(token)) return null;
    const session = randomBytes(32).toString("base64url");
    const insert = this.sessionInsert(session, viewer, null, now);
    const [created] = await this.database.batch([
      {
        sql: insert.sql.replace(
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          `
          SELECT ?, ?, ?, ?, ?, ?, ?, ? FROM discord_login_links
          WHERE token_hash = ? AND discord_user_id = ? AND expires_at > ?
        `,
        ),
        params: [...insert.params, tokenHash(token), viewer.id, now],
      },
      query(
        `DELETE FROM discord_login_links WHERE token_hash = ?
        AND EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash = ?)`,
        tokenHash(token),
        tokenHash(session),
      ),
      query("DELETE FROM auth_sessions WHERE expires_at <= ?", now),
    ]);
    return created.changes > 0 ? session : null;
  }

  close() {
    this.database.close();
  }
}
