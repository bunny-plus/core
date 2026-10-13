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
CREATE TABLE IF NOT EXISTS cinema_screenings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS cinema_ongoing_screening
        ON cinema_screenings((1)) WHERE ended_at IS NULL;
      CREATE TABLE IF NOT EXISTS cinema_progress (
        member_id TEXT NOT NULL,
        screening_id TEXT NOT NULL REFERENCES cinema_screenings(id),
        watched_ms INTEGER NOT NULL CHECK (watched_ms >= 0),
        PRIMARY KEY (member_id, screening_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cinema_tickets (
        id TEXT PRIMARY KEY,
        member_id TEXT NOT NULL,
        screening_id TEXT NOT NULL REFERENCES cinema_screenings(id),
        earned_at TEXT NOT NULL,
        number INTEGER NOT NULL CHECK (number > 0),
        UNIQUE (member_id, screening_id),
        UNIQUE (member_id, number)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cinema_ticket_designs (
        screening_id TEXT PRIMARY KEY REFERENCES cinema_screenings(id),
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        image_mime TEXT,
        image_data BLOB,
        CHECK ((image_mime IS NULL AND image_data IS NULL) OR
          (image_mime IS NOT NULL AND image_data IS NOT NULL))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cinema_ticket_artifacts (
        ticket_id TEXT PRIMARY KEY REFERENCES cinema_tickets(id),
        screening_id TEXT NOT NULL REFERENCES cinema_ticket_designs(screening_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cinema_ticket_bunnies (
        screening_id TEXT PRIMARY KEY REFERENCES cinema_ticket_designs(screening_id),
        parts TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cinema_legacy_ticket_bunnies (
        ticket_id TEXT PRIMARY KEY REFERENCES cinema_tickets(id),
        parts TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cinema_ticket_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cinema_counting_pauses (
        screening_id TEXT PRIMARY KEY REFERENCES cinema_screenings(id)
      ) STRICT;
