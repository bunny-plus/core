import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { SqlQuery, SqlRow } from "../shared/database";
import { AppDatabase, query } from "./database";

const tableSources = [
  ["sessions.sqlite", ["auth_sessions", "discord_login_links"]],
  ["chat.sqlite", ["room_chats"]],
  [
    "cinema.sqlite",
    [
      "cinema_screenings",
      "cinema_progress",
      "cinema_tickets",
      "cinema_ticket_designs",
      "cinema_ticket_artifacts",
      "cinema_ticket_bunnies",
      "cinema_legacy_ticket_bunnies",
      "cinema_ticket_migrations",
      "cinema_counting_pauses",
    ],
  ],
] as const;

type SourceTable = { name: string; keys: string[]; rows: SqlRow[] };
export type DataSnapshot = { tables: SourceTable[]; digest: string };
type ImportRecord = { source_hash: string; complete: number };

function identifier(name: string) {
  if (!/^[a-z_]+$/.test(name)) throw new Error("Unexpected database identifier");
  return `"${name}"`;
}

export function readSnapshot(directory: string): DataSnapshot {
  const tables: SourceTable[] = [];
  for (const [file, names] of tableSources) {
    const source = new DatabaseSync(join(directory, file), { readOnly: true });
    try {
      source.exec("BEGIN");
      for (const name of names) {
        if (
          !source.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
        ) {
          tables.push({ name, keys: [], rows: [] });
          continue;
        }
        const columns = source.prepare(`PRAGMA table_info(${identifier(name)})`).all();
        const keys = columns
          .filter((column) => Number(column.pk) > 0)
          .sort((a, b) => Number(a.pk) - Number(b.pk))
          .map((column) => String(column.name));
        const rows = source
          .prepare(`SELECT * FROM ${identifier(name)}`)
          .all()
          .map((row) => {
            const values = Object.values(row);
            const bytes = values.reduce<number>(
              (total, value) =>
                total +
                (value instanceof Uint8Array
                  ? value.byteLength
                  : Buffer.byteLength(String(value ?? ""))),
              0,
            );
            if (bytes > 2_000_000)
              throw new Error(`${name} contains a row larger than D1's 2 MB limit`);
            // SAFETY: node:sqlite returns scalar values and Uint8Array blobs; blobs are encoded explicitly.
            const result = Object.fromEntries(
              Object.entries(row).map(([column, value]) => [
                column,
                value instanceof Uint8Array
                  ? { blob: Buffer.from(value).toString("base64") }
                  : value,
              ]),
            ) as SqlRow;
            if (name === "auth_sessions" && !("auth_method" in result))
              result.auth_method = "oauth";
            Object.keys(result).forEach(identifier);
            return result;
          });
        rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        tables.push({ name, keys, rows });
      }
      source.exec("COMMIT");
    } finally {
      source.close();
    }
  }
  return { tables, digest: createHash("sha256").update(JSON.stringify(tables)).digest("hex") };
}

async function sendChunks(database: AppDatabase, statements: SqlQuery[], sizes: number[]) {
  let batch: SqlQuery[] = [];
  let bytes = 0;
  const results = [];
  for (const [index, statement] of statements.entries()) {
    if (batch.length && (batch.length >= 40 || bytes + sizes[index] > 4_000_000)) {
      results.push(...(await database.batch(batch)));
      batch = [];
      bytes = 0;
    }
    batch.push(statement);
    bytes += sizes[index];
  }
  if (batch.length) results.push(...(await database.batch(batch)));
  return results;
}

export async function importSnapshot(
  database: AppDatabase,
  snapshot: DataSnapshot,
  schema: string,
) {
  await database.exec(schema);
  await database.exec(`CREATE TABLE IF NOT EXISTS app_data_imports (
    name TEXT PRIMARY KEY, source_hash TEXT NOT NULL, complete INTEGER NOT NULL
  ) STRICT`);
  const previous = await database
    .prepare("SELECT source_hash, complete FROM app_data_imports WHERE name = 'sqlite-v1'")
    .get<ImportRecord>();
  if (previous && previous.source_hash !== snapshot.digest)
    throw new Error(
      "The target already belongs to a different SQLite snapshot; no data was overwritten",
    );
  if (!previous) {
    for (const table of snapshot.tables) {
      if (table.name === "cinema_ticket_migrations") continue;
      const count = await database
        .prepare(`SELECT COUNT(*) AS total FROM ${identifier(table.name)}`)
        .get<{ total: number }>();
      if (count?.total)
        throw new Error("The target database is not empty; no data was overwritten");
    }
    await database.batch([
      query("DELETE FROM cinema_ticket_migrations"),
      query(
        "INSERT INTO app_data_imports (name, source_hash, complete) VALUES ('sqlite-v1', ?, 0)",
        snapshot.digest,
      ),
    ]);
  }
  if (!previous?.complete) {
    for (const table of snapshot.tables) {
      const statements = table.rows.map((row) => ({
        sql: `INSERT OR IGNORE INTO ${identifier(table.name)} (${Object.keys(row).map(identifier).join(", ")}) VALUES (${Object.keys(
          row,
        )
          .map(() => "?")
          .join(", ")})`,
        params: Object.values(row),
      }));
      await sendChunks(
        database,
        statements,
        statements.map((statement) => JSON.stringify(statement).length),
      );
    }
  }
  for (const table of snapshot.tables) {
    const count = await database
      .prepare(`SELECT COUNT(*) AS total FROM ${identifier(table.name)}`)
      .get<{ total: number }>();
    if (count?.total !== table.rows.length)
      throw new Error(`Import verification failed for ${table.name}`);
    const statements = table.rows.map((row) => ({
      sql: `SELECT ${Object.keys(row).map(identifier).join(", ")} FROM ${identifier(table.name)} WHERE ${table.keys.map((key) => `${identifier(key)} = ?`).join(" AND ")}`,
      params: table.keys.map((key) => row[key]),
    }));
    const results = await sendChunks(
      database,
      statements,
      table.rows.map((row) => JSON.stringify(row).length),
    );
    if (
      results.some(
        (result, index) =>
          result.rows.length !== 1 ||
          JSON.stringify(result.rows[0]) !== JSON.stringify(table.rows[index]),
      )
    )
      throw new Error(`Import verification failed for ${table.name}`);
  }
  await database.prepare("UPDATE app_data_imports SET complete = 1 WHERE name = 'sqlite-v1'").run();
}
