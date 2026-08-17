import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type RoomChat = {
  createdAt: string;
  id: string;
  member: {
    admin: boolean;
    avatar: string | null;
    id: string;
    name: string;
  };
  message: string;
  type: "chat";
  x: number;
};

type ChatRow = {
  created_at: string;
  id: string;
  member_admin: number;
  member_avatar: string | null;
  member_id: string;
  member_name: string;
  message: string;
  x: number;
};

export class ChatHistory {
  private readonly database: DatabaseSync;
  private readonly insert;
  private readonly prune;
  private readonly selectRecent;

  constructor(
    file: string,
    private readonly limit: number,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error("Chat history limit must be positive");
    mkdirSync(dirname(file), { recursive: true });
    this.database = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS room_chats (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        member_id TEXT NOT NULL,
        member_name TEXT NOT NULL,
        member_avatar TEXT,
        member_admin INTEGER NOT NULL CHECK (member_admin IN (0, 1)),
        message TEXT NOT NULL,
        x REAL NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS room_chats_created_at ON room_chats(created_at, sequence);
    `);
    this.insert = this.database.prepare(`
      INSERT INTO room_chats (
        id, created_at, member_id, member_name, member_avatar, member_admin, message, x
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.prune = this.database.prepare(`
      DELETE FROM room_chats
      WHERE sequence IN (
        SELECT sequence FROM room_chats ORDER BY created_at DESC, sequence DESC LIMIT -1 OFFSET ?
      )
    `);
    this.selectRecent = this.database.prepare(`
      SELECT id, created_at, member_id, member_name, member_avatar, member_admin, message, x
      FROM room_chats
      ORDER BY created_at DESC, sequence DESC
      LIMIT ?
    `);
  }

  all(): RoomChat[] {
    // SAFETY: The query selects these exact columns from the STRICT schema created above.
    const rows = this.selectRecent.all(this.limit) as ChatRow[];
    return rows.reverse().map((row) => ({
      createdAt: row.created_at,
      id: row.id,
      member: {
        admin: row.member_admin === 1,
        avatar: row.member_avatar,
        id: row.member_id,
        name: row.member_name,
      },
      message: row.message,
      type: "chat",
      x: row.x,
    }));
  }

  append(chat: RoomChat) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.insert.run(
        chat.id,
        chat.createdAt,
        chat.member.id,
        chat.member.name,
        chat.member.avatar,
        chat.member.admin ? 1 : 0,
        chat.message,
        chat.x,
      );
      this.prune.run(this.limit);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}
