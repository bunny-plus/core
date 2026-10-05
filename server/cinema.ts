import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
type EligibleMemberRow = { member_id: string };
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
  private readonly database: DatabaseSync;
  private readonly pulses = new Map<string, WatchingPulse>();
  private readonly intervals = new Map<string, WatchInterval[]>();
  private playbackAvailable = false;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.database = new DatabaseSync(file);
    if (file !== ":memory:") chmodSync(file, 0o600);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
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
      this.migrateTicketBunnies();
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  private migrateTicketBunnies() {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const migration = "pixel-bunnies-v1";
      if (
        this.database
          .prepare("SELECT 1 FROM cinema_ticket_migrations WHERE name = ?")
          .get(migration)
      ) {
        this.database.exec("COMMIT");
        return;
      }
      // SAFETY: screening_id is TEXT in the STRICT ticket design schema above.
      const designs = this.database
        .prepare(`
        SELECT d.screening_id FROM cinema_ticket_designs d
        LEFT JOIN cinema_ticket_bunnies b ON b.screening_id = d.screening_id
        WHERE b.screening_id IS NULL
      `)
        .all() as ArtworkScreening[];
      const addDesign = this.database.prepare(
        "INSERT INTO cinema_ticket_bunnies (screening_id, parts) VALUES (?, ?)",
      );
      for (const design of designs)
        addDesign.run(
          design.screening_id,
          JSON.stringify(generateTicketBunny(design.screening_id)),
        );

      // Early tickets predate editable designs. Give those tickets artwork without
      // attaching them to later designs, which would replace their original titles.
      // SAFETY: These columns come from the STRICT ticket and bunny tables above.
      const legacy = this.database
        .prepare(`
        SELECT t.id, t.screening_id, b.parts AS bunny_json FROM cinema_tickets t
        LEFT JOIN cinema_ticket_artifacts a ON a.ticket_id = t.id
        LEFT JOIN cinema_ticket_bunnies b ON b.screening_id = t.screening_id
        LEFT JOIN cinema_legacy_ticket_bunnies l ON l.ticket_id = t.id
        WHERE a.ticket_id IS NULL AND l.ticket_id IS NULL
      `)
        .all() as LegacyBunnyRecipient[];
      const addLegacy = this.database.prepare(
        "INSERT INTO cinema_legacy_ticket_bunnies (ticket_id, parts) VALUES (?, ?)",
      );
      for (const ticket of legacy)
        addLegacy.run(
          ticket.id,
          ticket.bunny_json ?? JSON.stringify(generateTicketBunny(ticket.screening_id)),
        );

      // Uploaded image bytes stay available to older clients and for recovery.
      // Run once: a new ticket deliberately created with no artwork stays blank.
      this.database
        .prepare("INSERT INTO cinema_ticket_migrations (name, applied_at) VALUES (?, ?)")
        .run(migration, new Date().toISOString());
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  current(): CinemaScreening | null {
    // SAFETY: These exact columns come from the STRICT cinema_screenings schema above.
    const row = this.database
      .prepare(`
        SELECT s.id, s.title, s.started_at, d.title AS design_title,
          d.created_at AS design_created_at, d.image_data IS NOT NULL AS image_present,
          p.screening_id IS NOT NULL AS counting_paused, b.parts AS bunny_json
        FROM cinema_screenings s LEFT JOIN cinema_ticket_designs d ON d.screening_id = s.id
        LEFT JOIN cinema_counting_pauses p ON p.screening_id = s.id
        LEFT JOIN cinema_ticket_bunnies b ON b.screening_id = d.screening_id
        WHERE s.ended_at IS NULL
      `)
      .get() as ScreeningRow | undefined;
    return row ? screeningFromRow(row) : null;
  }

  start(title: string | null | undefined, now = Date.now()): CinemaScreening {
    const screening: CinemaScreening = {
      id: randomUUID(),
      title: screeningTitle(title),
      startedAt: new Date(now).toISOString(),
      ticketCountingEnabled: true,
      ticketDesign: null,
    };
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare("UPDATE cinema_screenings SET ended_at = ? WHERE ended_at IS NULL")
        .run(screening.startedAt);
      this.database
        .prepare("INSERT INTO cinema_screenings (id, title, started_at) VALUES (?, ?, ?)")
        .run(screening.id, screening.title, screening.startedAt);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    this.pulses.clear();
    this.intervals.clear();
    this.playbackAvailable = true;
    return screening;
  }

  observe(running: boolean, title: string | null | undefined): CinemaScreening | null {
    this.playbackAvailable = running;
    if (!running) this.pulses.clear();
    const current = this.current();
    // A failed controller poll or a temporary relay outage must not divide a screening.
    // Only a successful explicit stop ends it; a known new title starts the next one.
    if (!running) return current;
    if (!current || (title?.trim() && screeningTitle(title) !== current.title))
      return this.start(title);
    return current;
  }

  stop(now = Date.now()) {
    this.database
      .prepare("UPDATE cinema_screenings SET ended_at = ? WHERE ended_at IS NULL")
      .run(new Date(now).toISOString());
    this.pulses.clear();
    this.intervals.clear();
    this.playbackAvailable = false;
  }

  setTicketCounting(screeningId: string, enabled: boolean): CinemaScreening | null {
    const screening = this.current();
    if (!screening || screening.id !== screeningId) return null;
    if (enabled)
      this.database
        .prepare("DELETE FROM cinema_counting_pauses WHERE screening_id = ?")
        .run(screeningId);
    else
      this.database
        .prepare("INSERT OR IGNORE INTO cinema_counting_pauses (screening_id) VALUES (?)")
        .run(screeningId);
    // Neither a stopped interval nor time before resuming can bridge two watching pulses.
    if (screening.ticketCountingEnabled !== enabled) this.pulses.clear();
    return { ...screening, ticketCountingEnabled: enabled };
  }

  createTicket(
    screeningId: string,
    title: string,
    image: CinemaImage | null,
    now = Date.now(),
    bunny?: TicketBunny,
  ): CinemaScreening | null {
    if (bunny !== undefined && (!isTicketBunny(bunny) || image !== null))
      throw new Error("A ticket needs either valid bunny parts or an uploaded image");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const screening = this.current();
      if (!screening || screening.id !== screeningId || screening.ticketDesign) {
        this.database.exec("COMMIT");
        return null;
      }
      const createdAt = new Date(now).toISOString();
      this.database
        .prepare(`
          INSERT INTO cinema_ticket_designs (screening_id, title, created_at, image_mime, image_data)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(screeningId, title, createdAt, image?.mimeType ?? null, image?.data ?? null);
      if (bunny)
        this.database
          .prepare("INSERT INTO cinema_ticket_bunnies (screening_id, parts) VALUES (?, ?)")
          .run(screeningId, JSON.stringify(bunny));
      // SAFETY: member_id is TEXT in the STRICT cinema_progress table created above.
      const eligible = this.database
        .prepare("SELECT member_id FROM cinema_progress WHERE screening_id = ? AND watched_ms >= ?")
        .all(screeningId, ticketWatchSeconds * 1_000) as EligibleMemberRow[];
      for (const member of eligible) this.awardTicket(member.member_id, screeningId, now);
      this.database.exec("COMMIT");
      const ticketDesign: CinemaTicketDesign = {
        title,
        imagePath: image ? imagePath(screeningId) : null,
        createdAt,
      };
      if (bunny) ticketDesign.bunny = { ...bunny };
      return {
        ...screening,
        ticketDesign,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  image(screeningId: string): CinemaImage | null {
    // SAFETY: The STRICT designs schema stores a non-null TEXT MIME with each BLOB image.
    const row = this.database
      .prepare(
        "SELECT image_mime, image_data FROM cinema_ticket_designs WHERE screening_id = ? AND image_data IS NOT NULL",
      )
      .get(screeningId) as ImageRow | undefined;
    return row ? { mimeType: row.image_mime, data: row.image_data } : null;
  }

  progress(memberId: string): CinemaProgress {
    const screening = this.current();
    if (!screening)
      return {
        screening: null,
        watchedSeconds: 0,
        requiredSeconds: ticketWatchSeconds,
        ticket: null,
      };
    // SAFETY: watched_ms is an INTEGER in the STRICT cinema_progress table.
    const row = this.database
      .prepare("SELECT watched_ms FROM cinema_progress WHERE member_id = ? AND screening_id = ?")
      .get(memberId, screening.id) as ProgressRow | undefined;
    return {
      screening,
      watchedSeconds: Math.floor((row?.watched_ms ?? 0) / 1_000),
      requiredSeconds: ticketWatchSeconds,
      ticket: this.ticket(memberId, screening.id),
    };
  }

  watching(
    memberId: string,
    connectionId: string,
    screeningId: string,
    playing: boolean,
    now = Date.now(),
  ): CinemaProgress {
    const screening = this.current();
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
        if (added > 0) this.recordWatching(memberId, screeningId, added, now);
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

  collection(memberId: string): CinemaCollection {
    // SAFETY: The joined STRICT tables provide these exact ticket and screening columns.
    const rows = this.database
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
      .all(memberId, collectionLimit) as TicketRow[];
    // SAFETY: COUNT returns one row containing an integer total.
    const count = this.database
      .prepare("SELECT COUNT(*) AS total FROM cinema_tickets WHERE member_id = ?")
      .get(memberId) as CountRow;
    return { tickets: rows.map(ticketFromRow), total: count.total };
  }

  close() {
    this.database.close();
  }

  private ticket(memberId: string, screeningId: string): CinemaTicket | null {
    // SAFETY: The joined STRICT tables provide these exact ticket and screening columns.
    const row = this.database
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
      .get(memberId, screeningId) as TicketRow | undefined;
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

  private recordWatching(memberId: string, screeningId: string, milliseconds: number, now: number) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          INSERT INTO cinema_progress (member_id, screening_id, watched_ms) VALUES (?, ?, ?)
          ON CONFLICT (member_id, screening_id) DO UPDATE
            SET watched_ms = MIN(?, cinema_progress.watched_ms + excluded.watched_ms)
        `)
        .run(memberId, screeningId, milliseconds, ticketWatchSeconds * 1_000);
      this.awardTicket(memberId, screeningId, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private awardTicket(memberId: string, screeningId: string, now: number) {
    const id = randomUUID();
    const inserted = this.database
      .prepare(`
        INSERT OR IGNORE INTO cinema_tickets (id, member_id, screening_id, earned_at, number)
        SELECT ?, ?, ?, ?, COALESCE(MAX(number), 0) + 1
        FROM cinema_tickets WHERE member_id = ?
        HAVING (SELECT watched_ms FROM cinema_progress WHERE member_id = ? AND screening_id = ?) >= ?
          AND EXISTS (SELECT 1 FROM cinema_ticket_designs WHERE screening_id = ?)
      `)
      .run(
        id,
        memberId,
        screeningId,
        new Date(now).toISOString(),
        memberId,
        memberId,
        screeningId,
        ticketWatchSeconds * 1_000,
        screeningId,
      );
    if (Number(inserted.changes) > 0)
      this.database
        .prepare("INSERT INTO cinema_ticket_artifacts (ticket_id, screening_id) VALUES (?, ?)")
        .run(id, screeningId);
  }
}
