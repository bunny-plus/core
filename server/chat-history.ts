import { AppDatabase, SqliteDatabase, query } from "./database";

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
  private readonly database: AppDatabase;
  readonly ready: Promise<void>;

  constructor(
    file: string | AppDatabase,
    private readonly limit: number,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error("Chat history limit must be positive");
    this.database = file instanceof AppDatabase ? file : new SqliteDatabase(file);
    this.ready = this.database.exec(`
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
  }

  async all(): Promise<RoomChat[]> {
    await this.ready;
    // SAFETY: The query selects these exact columns from the STRICT schema created above.
    const rows = await this.database
      .prepare(`
      SELECT id, created_at, member_id, member_name, member_avatar, member_admin, message, x
      FROM room_chats ORDER BY created_at DESC, sequence DESC LIMIT ?
    `)
      .all<ChatRow>(this.limit);
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

  async append(chat: RoomChat) {
    await this.ready;
    await this.database.batch([
      query(
        `INSERT INTO room_chats (
        id, created_at, member_id, member_name, member_avatar, member_admin, message, x
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        chat.id,
        chat.createdAt,
        chat.member.id,
        chat.member.name,
        chat.member.avatar,
        chat.member.admin ? 1 : 0,
        chat.message,
        chat.x,
      ),
      query(
        `DELETE FROM room_chats WHERE sequence IN (
        SELECT sequence FROM room_chats ORDER BY created_at DESC, sequence DESC LIMIT -1 OFFSET ?
      )`,
        this.limit,
      ),
    ]);
  }

  close() {
    this.database.close();
  }
}
