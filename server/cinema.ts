import { SerialQueue } from "./serial-queue";
import { randomUUID } from "node:crypto";
import { AppDatabase, SqliteDatabase, query } from "./database";
import { generateTicketBunny, isTicketBunny, type TicketBunny } from "../shared/ticket-bunny";

import {
  ticketWatchSeconds,
  type CinemaCollection,
  type CinemaProgress,
  type CinemaScreening,
  type CinemaTicket,
  type CinemaTicketDesign,
} from "../shared/cinema";

type ScreeningRow = {
  id: string;
  title: string;
  started_at: string;
  counting_paused: number;
  design_title: string | null;
  design_created_at: string | null;
  image_present: number;
  bunny_json: string | null;
};
export type CinemaImage = { mimeType: string; data: Uint8Array };
type ImageRow = { image_mime: string; image_data: Uint8Array };
type ProgressRow = { watched_ms: number };
type TicketRow = {
  id: string;
  screening_id: string;
  title: string;
  started_at: string;
  earned_at: string;
  number: number;
  image_present: number;
  bunny_json: string | null;
};
type CountRow = { total: number };
type ArtworkScreening = { screening_id: string };
type LegacyBunnyRecipient = { id: string; screening_id: string; bunny_json: string | null };
type WatchingPulse = {
  memberId: string;
  screeningId: string;
  playing: boolean;
  at: number;
};
type WatchInterval = { start: number; end: number };

const maximumPulseGap = 30_000;
const collectionLimit = 100;

function screeningFromRow(row: ScreeningRow): CinemaScreening {
  const screening: CinemaScreening = {
    id: row.id,
    title: row.title,
    startedAt: row.started_at,
    ticketCountingEnabled: !row.counting_paused,
    ticketDesign:
      row.design_title !== null && row.design_created_at !== null
        ? {
            title: row.design_title,
            createdAt: row.design_created_at,
            imagePath: row.image_present ? imagePath(row.id) : null,
          }
        : null,
  };
  const bunny = storedBunny(row.bunny_json);
  if (screening.ticketDesign && bunny) screening.ticketDesign.bunny = bunny;
  return screening;
}

function storedBunny(json: string | null): TicketBunny | undefined {
  if (!json) return undefined;
  const value = JSON.parse(json);
  if (!isTicketBunny(value)) throw new Error("Invalid stored ticket bunny");
  return value;
}

function imagePath(screeningId: string) {
  return `/api/cinema/screenings/${screeningId}/image`;
}

function ticketFromRow(row: TicketRow): CinemaTicket {
  const ticket: CinemaTicket = {
    id: row.id,
    screeningId: row.screening_id,
    title: row.title,
    screenedAt: row.started_at,
    earnedAt: row.earned_at,
    number: row.number,
    imagePath: row.image_present ? imagePath(row.screening_id) : null,
  };
  const bunny = storedBunny(row.bunny_json);
  if (bunny) ticket.bunny = bunny;
  return ticket;
}

function screeningTitle(title: string | null | undefined) {
  return title?.trim().slice(0, 200) || "Live screening";
}

export class CinemaDiary {
  private readonly database: AppDatabase;
  readonly ready: Promise<void>;
  private readonly queue = new SerialQueue();
  private readonly pulses = new Map<string, WatchingPulse>();
  private readonly intervals = new Map<string, WatchInterval[]>();
  private playbackAvailable = false;

  constructor(file: string | AppDatabase) {
    this.database = file instanceof AppDatabase ? file : new SqliteDatabase(file);
    this.ready = this.initialize();
  }

  private async initialize() {
    await this.database.exec(`
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
    `);
    try {
      await this.migrateTicketBunnies();
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  private async migrateTicketBunnies() {
    const migration = "pixel-bunnies-v1";
    if (
      await this.database
        .prepare("SELECT 1 FROM cinema_ticket_migrations WHERE name = ?")
        .get(migration)
    )
      return;
    const designs = await this.database
      .prepare(`
      SELECT d.screening_id FROM cinema_ticket_designs d
      LEFT JOIN cinema_ticket_bunnies b ON b.screening_id = d.screening_id
      WHERE b.screening_id IS NULL
    `)
      .all<ArtworkScreening>();
    const legacy = await this.database
      .prepare(`
      SELECT t.id, t.screening_id, b.parts AS bunny_json FROM cinema_tickets t
      LEFT JOIN cinema_ticket_artifacts a ON a.ticket_id = t.id
      LEFT JOIN cinema_ticket_bunnies b ON b.screening_id = t.screening_id
      LEFT JOIN cinema_legacy_ticket_bunnies l ON l.ticket_id = t.id
      WHERE a.ticket_id IS NULL AND l.ticket_id IS NULL
    `)
      .all<LegacyBunnyRecipient>();
    const statements = [
      ...designs.map((design) =>
        query(
          "INSERT OR IGNORE INTO cinema_ticket_bunnies (screening_id, parts) VALUES (?, ?)",
          design.screening_id,
          JSON.stringify(generateTicketBunny(design.screening_id)),
        ),
      ),
      ...legacy.map((ticket) =>
        query(
          "INSERT OR IGNORE INTO cinema_legacy_ticket_bunnies (ticket_id, parts) VALUES (?, ?)",
          ticket.id,
          ticket.bunny_json ?? JSON.stringify(generateTicketBunny(ticket.screening_id)),
        ),
      ),
      query(
        "INSERT OR IGNORE INTO cinema_ticket_migrations (name, applied_at) VALUES (?, ?)",
        migration,
        new Date().toISOString(),
      ),
    ];
    for (let offset = 0; offset < statements.length; offset += 50)
      await this.database.batch(statements.slice(offset, offset + 50));
  }

  start(title: string | null | undefined, now = Date.now()) {
    return this.queue.run(() => this.startScreening(title, now));
  }

  observe(running: boolean, title: string | null | undefined) {
    return this.queue.run(() => this.observeScreening(running, title));
  }

  setTicketCounting(screeningId: string, enabled: boolean) {
    return this.queue.run(() => this.changeTicketCounting(screeningId, enabled));
  }

  createTicket(
    screeningId: string,
    title: string,
    image: CinemaImage | null,
    now = Date.now(),
    bunny?: TicketBunny,
  ) {
    return this.queue.run(() => this.createTicketDesign(screeningId, title, image, now, bunny));
  }

  watching(
    memberId: string,
    connectionId: string,
    screeningId: string,
    playing: boolean,
    now = Date.now(),
  ) {
    return this.queue.run(() =>
      this.recordPulse(memberId, connectionId, screeningId, playing, now),
    );
  }

  async current(): Promise<CinemaScreening | null> {
    await this.ready;
    const row = await this.database
      .prepare(`
        SELECT s.id, s.title, s.started_at, d.title AS design_title,
          d.created_at AS design_created_at, d.image_data IS NOT NULL AS image_present,
          p.screening_id IS NOT NULL AS counting_paused, b.parts AS bunny_json
        FROM cinema_screenings s LEFT JOIN cinema_ticket_designs d ON d.screening_id = s.id
        LEFT JOIN cinema_counting_pauses p ON p.screening_id = s.id
        LEFT JOIN cinema_ticket_bunnies b ON b.screening_id = d.screening_id
        WHERE s.ended_at IS NULL
      `)
      .get<ScreeningRow>();
    return row ? screeningFromRow(row) : null;
  }

  private async startScreening(
    title: string | null | undefined,
    now: number,
  ): Promise<CinemaScreening> {
    await this.ready;
    const screening: CinemaScreening = {
      id: randomUUID(),
      title: screeningTitle(title),
      startedAt: new Date(now).toISOString(),
      ticketCountingEnabled: true,
      ticketDesign: null,
    };
    await this.database.batch([
      query(
        "UPDATE cinema_screenings SET ended_at = ? WHERE ended_at IS NULL",
        screening.startedAt,
      ),
      query(
        "INSERT INTO cinema_screenings (id, title, started_at) VALUES (?, ?, ?)",
        screening.id,
        screening.title,
        screening.startedAt,
      ),
    ]);
    this.pulses.clear();
    this.intervals.clear();
    this.playbackAvailable = true;
    return screening;
  }

  private async observeScreening(
    running: boolean,
    title: string | null | undefined,
  ): Promise<CinemaScreening | null> {
    this.playbackAvailable = running;
    if (!running) this.pulses.clear();
    const current = await this.current();
    if (!running) return current;
    if (!current || (title?.trim() && screeningTitle(title) !== current.title))
      return this.startScreening(title, Date.now());
    return current;
  }

  stop(now = Date.now()) {
    return this.queue.run(async () => {
      await this.ready;
      await this.database
        .prepare("UPDATE cinema_screenings SET ended_at = ? WHERE ended_at IS NULL")
        .run(new Date(now).toISOString());
      this.pulses.clear();
      this.intervals.clear();
      this.playbackAvailable = false;
    });
  }

  private async changeTicketCounting(
    screeningId: string,
    enabled: boolean,
  ): Promise<CinemaScreening | null> {
    const screening = await this.current();
    if (!screening || screening.id !== screeningId) return null;
    if (enabled)
      await this.database
        .prepare("DELETE FROM cinema_counting_pauses WHERE screening_id = ?")
        .run(screeningId);
    else
      await this.database
        .prepare("INSERT OR IGNORE INTO cinema_counting_pauses (screening_id) VALUES (?)")
        .run(screeningId);
    if (screening.ticketCountingEnabled !== enabled) this.pulses.clear();
    return { ...screening, ticketCountingEnabled: enabled };
  }

  private async createTicketDesign(
    screeningId: string,
    title: string,
    image: CinemaImage | null,
    now: number,
    bunny?: TicketBunny,
  ): Promise<CinemaScreening | null> {
    if (bunny !== undefined && (!isTicketBunny(bunny) || image !== null))
      throw new Error("A ticket needs either valid bunny parts or an uploaded image");
    const screening = await this.current();
    if (!screening || screening.id !== screeningId || screening.ticketDesign) return null;
    const createdAt = new Date(now).toISOString();
    const statements = [
      query(
        `
      INSERT INTO cinema_ticket_designs (screening_id, title, created_at, image_mime, image_data)
      SELECT ?, ?, ?, ?, ? FROM cinema_screenings WHERE id = ? AND ended_at IS NULL
      ON CONFLICT(screening_id) DO NOTHING
    `,
        screeningId,
        title,
        createdAt,
        image?.mimeType ?? null,
        image?.data ?? null,
        screeningId,
      ),
    ];
    if (bunny)
      statements.push(
        query(
          `
      INSERT INTO cinema_ticket_bunnies (screening_id, parts) SELECT ?, ? WHERE changes() = 1
    `,
          screeningId,
          JSON.stringify(bunny),
        ),
      );
    const ticketPrefix = `${randomUUID()}.`;
    statements.push(
      query(
        `
      INSERT OR IGNORE INTO cinema_tickets (id, member_id, screening_id, earned_at, number)
      SELECT ? || lower(hex(randomblob(16))), p.member_id, p.screening_id, ?,
        (SELECT COALESCE(MAX(t.number), 0) + 1 FROM cinema_tickets t WHERE t.member_id = p.member_id)
      FROM cinema_progress p WHERE p.screening_id = ? AND p.watched_ms >= ?
        AND EXISTS (SELECT 1 FROM cinema_ticket_designs WHERE screening_id = ?)
    `,
        ticketPrefix,
        createdAt,
        screeningId,
        ticketWatchSeconds * 1_000,
        screeningId,
      ),
    );
    statements.push(
      query(
        `
      INSERT INTO cinema_ticket_artifacts (ticket_id, screening_id)
      SELECT id, screening_id FROM cinema_tickets WHERE id LIKE ?
    `,
        `${ticketPrefix}%`,
      ),
    );
    const [inserted] = await this.database.batch(statements);
    if (!inserted.changes) return null;
    const ticketDesign: CinemaTicketDesign = {
      title,
      imagePath: image ? imagePath(screeningId) : null,
      createdAt,
    };
    if (bunny) ticketDesign.bunny = { ...bunny };
    return { ...screening, ticketDesign };
  }

  async image(screeningId: string): Promise<CinemaImage | null> {
    await this.ready;
    const row = await this.database
      .prepare(
        "SELECT image_mime, image_data FROM cinema_ticket_designs WHERE screening_id = ? AND image_data IS NOT NULL",
      )
      .get<ImageRow>(screeningId);
    return row ? { mimeType: row.image_mime, data: row.image_data } : null;
  }

  async progress(memberId: string): Promise<CinemaProgress> {
    const screening = await this.current();
    if (!screening)
      return {
        screening: null,
        watchedSeconds: 0,
        requiredSeconds: ticketWatchSeconds,
        ticket: null,
      };
    const row = await this.database
      .prepare("SELECT watched_ms FROM cinema_progress WHERE member_id = ? AND screening_id = ?")
      .get<ProgressRow>(memberId, screening.id);
    return {
      screening,
      watchedSeconds: Math.floor((row?.watched_ms ?? 0) / 1_000),
      requiredSeconds: ticketWatchSeconds,
      ticket: await this.ticket(memberId, screening.id),
    };
  }

  private async recordPulse(
    memberId: string,
    connectionId: string,
    screeningId: string,
    playing: boolean,
    now = Date.now(),
  ): Promise<CinemaProgress> {
    const screening = await this.current();
    const previous = this.pulses.get(connectionId);
    if (
      !screening ||
      screening.id !== screeningId ||
      !screening.ticketCountingEnabled ||
      !this.playbackAvailable
    ) {
      this.pulses.delete(connectionId);
      return this.progress(memberId);
    }
    this.pulses.set(connectionId, { memberId, screeningId, playing, at: now });
    if (
      previous?.memberId === memberId &&
      previous.screeningId === screeningId &&
      previous.playing &&
      playing &&
      now > previous.at &&
      now - previous.at <= maximumPulseGap
    ) {
      const previousIntervals = this.intervals.get(memberId);
      const added = this.coverInterval(memberId, previous.at, now);
      try {
        if (added > 0) await this.recordWatching(memberId, screeningId, added, now);
      } catch (error) {
        this.pulses.set(connectionId, previous);
        if (previousIntervals) this.intervals.set(memberId, previousIntervals);
        else this.intervals.delete(memberId);
        throw error;
      }
    }
    return this.progress(memberId);
  }

  disconnect(connectionId: string) {
    const pulse = this.pulses.get(connectionId);
    this.pulses.delete(connectionId);
    if (pulse && ![...this.pulses.values()].some((entry) => entry.memberId === pulse.memberId))
      this.intervals.delete(pulse.memberId);
  }

  async collection(memberId: string): Promise<CinemaCollection> {
    await this.ready;
    const rows = await this.database
      .prepare(`
        SELECT t.id, t.screening_id, COALESCE(d.title, s.title) AS title,
          s.started_at, t.earned_at, t.number, d.image_data IS NOT NULL AS image_present,
          COALESCE(b.parts, l.parts) AS bunny_json
        FROM cinema_tickets t JOIN cinema_screenings s ON s.id = t.screening_id
        LEFT JOIN cinema_ticket_artifacts a ON a.ticket_id = t.id
        LEFT JOIN cinema_ticket_designs d ON d.screening_id = a.screening_id
        LEFT JOIN cinema_ticket_bunnies b ON b.screening_id = d.screening_id
        LEFT JOIN cinema_legacy_ticket_bunnies l ON l.ticket_id = t.id
        WHERE t.member_id = ? ORDER BY t.number DESC LIMIT ?
      `)
      .all<TicketRow>(memberId, collectionLimit);
    const count = await this.database
      .prepare("SELECT COUNT(*) AS total FROM cinema_tickets WHERE member_id = ?")
      .get<CountRow>(memberId);
    return { tickets: rows.map(ticketFromRow), total: count?.total ?? 0 };
  }

  close() {
    this.database.close();
  }

  private async ticket(memberId: string, screeningId: string): Promise<CinemaTicket | null> {
    const row = await this.database
      .prepare(`
        SELECT t.id, t.screening_id, COALESCE(d.title, s.title) AS title,
          s.started_at, t.earned_at, t.number, d.image_data IS NOT NULL AS image_present,
          COALESCE(b.parts, l.parts) AS bunny_json
        FROM cinema_tickets t JOIN cinema_screenings s ON s.id = t.screening_id
        LEFT JOIN cinema_ticket_artifacts a ON a.ticket_id = t.id
        LEFT JOIN cinema_ticket_designs d ON d.screening_id = a.screening_id
        LEFT JOIN cinema_ticket_bunnies b ON b.screening_id = d.screening_id
        LEFT JOIN cinema_legacy_ticket_bunnies l ON l.ticket_id = t.id
        WHERE t.member_id = ? AND t.screening_id = ?
      `)
      .get<TicketRow>(memberId, screeningId);
    return row ? ticketFromRow(row) : null;
  }

  private coverInterval(memberId: string, start: number, end: number) {
    const recent = (this.intervals.get(memberId) ?? []).filter(
      (interval) => interval.end > end - maximumPulseGap,
    );
    const overlap = recent.reduce(
      (total, interval) =>
        total + Math.max(0, Math.min(end, interval.end) - Math.max(start, interval.start)),
      0,
    );
    const merged: WatchInterval[] = [];
    for (const interval of [...recent, { start, end }].sort((a, b) => a.start - b.start)) {
      const last = merged.at(-1);
      if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
      else merged.push({ ...interval });
    }
    this.intervals.set(memberId, merged);
    return Math.max(0, end - start - overlap);
  }

  private async recordWatching(
    memberId: string,
    screeningId: string,
    milliseconds: number,
    now: number,
  ) {
    const cap = ticketWatchSeconds * 1_000;
    await this.database.batch([
      query(
        `
        INSERT INTO cinema_progress (member_id, screening_id, watched_ms) VALUES (?, ?, MIN(?, ?))
        ON CONFLICT (member_id, screening_id) DO UPDATE
          SET watched_ms = MIN(?, cinema_progress.watched_ms + excluded.watched_ms)
          WHERE cinema_progress.watched_ms < ?
      `,
        memberId,
        screeningId,
        milliseconds,
        cap,
        cap,
        cap,
      ),
      ...this.awardQueries(memberId, screeningId, now),
    ]);
  }

  private awardQueries(memberId: string, screeningId: string, now: number) {
    const id = randomUUID();
    return [
      query(
        `
        INSERT OR IGNORE INTO cinema_tickets (id, member_id, screening_id, earned_at, number)
        SELECT ?, ?, ?, ?, COALESCE(MAX(number), 0) + 1
        FROM cinema_tickets WHERE member_id = ?
        HAVING (SELECT watched_ms FROM cinema_progress WHERE member_id = ? AND screening_id = ?) >= ?
          AND EXISTS (SELECT 1 FROM cinema_ticket_designs WHERE screening_id = ?)
      `,
        id,
        memberId,
        screeningId,
        new Date(now).toISOString(),
        memberId,
        memberId,
        screeningId,
        ticketWatchSeconds * 1_000,
        screeningId,
      ),
      query(
        `
        INSERT INTO cinema_ticket_artifacts (ticket_id, screening_id)
        SELECT ?, ? WHERE EXISTS (SELECT 1 FROM cinema_tickets WHERE id = ?)
      `,
        id,
        screeningId,
        id,
      ),
    ];
  }
}
