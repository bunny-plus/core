import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { isViewer, sessionLifetimeSeconds, type Viewer } from "../worker/session";
import type { JsonValue } from "./upstream";

export type DiscordCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type StoredSession = {
  viewer: Viewer;
  credentials: DiscordCredentials;
  checkedAt: number;
};

type SessionRow = {
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

export class AuthSessions {
  private readonly database: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.database = new DatabaseSync(file);
    if (file !== ":memory:") chmodSync(file, 0o600);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        viewer_json TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        access_expires_at INTEGER NOT NULL,
        checked_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
    `);
  }

  create(viewer: Omit<Viewer, "expires">, credentials: DiscordCredentials, now = Date.now()) {
    const token = randomBytes(32).toString("base64url");
    const expires = now + sessionLifetimeSeconds * 1_000;
    this.database.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
    this.database
      .prepare(`
        INSERT INTO auth_sessions (
          token_hash, viewer_json, access_token, refresh_token, access_expires_at, checked_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        tokenHash(token),
        JSON.stringify({ ...viewer, expires }),
        credentials.accessToken,
        credentials.refreshToken,
        credentials.expiresAt,
        now,
        expires,
      );
    return token;
  }

  read(token: string, now = Date.now()): StoredSession | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    // SAFETY: The query selects these exact columns from the STRICT schema above.
    const row = this.database
      .prepare("SELECT * FROM auth_sessions WHERE token_hash = ? AND expires_at > ?")
      .get(tokenHash(token), now) as SessionRow | undefined;
    if (!row) return null;
    const viewer: JsonValue = JSON.parse(row.viewer_json);
    if (!isViewer(viewer)) return null;
    return {
      viewer: { ...viewer, expires: row.expires_at },
      credentials: {
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        expiresAt: row.access_expires_at,
      },
      checkedAt: row.checked_at,
    };
  }

  update(token: string, viewer: Viewer, credentials: DiscordCredentials, checkedAt = Date.now()) {
    return (
      this.database
        .prepare(`
          UPDATE auth_sessions SET viewer_json = ?, access_token = ?, refresh_token = ?,
            access_expires_at = ?, checked_at = ?
          WHERE token_hash = ? AND expires_at > ?
        `)
        .run(
          JSON.stringify(viewer),
          credentials.accessToken,
          credentials.refreshToken,
          credentials.expiresAt,
          checkedAt,
          tokenHash(token),
          Date.now(),
        ).changes > 0
    );
  }

  renew(token: string, now = Date.now()) {
    return (
      this.database
        .prepare("UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ? AND expires_at > ?")
        .run(now + sessionLifetimeSeconds * 1_000, tokenHash(token), now).changes > 0
    );
  }

  revoke(token: string) {
    this.database.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash(token));
  }

  close() {
    this.database.close();
  }
}
