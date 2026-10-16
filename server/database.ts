import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { isBlobParameter, isSqlResults, type SqlQuery, type SqlResult } from "../shared/database";
import { fetchJson, UpstreamError } from "./upstream";
import type { JsonValue } from "../shared/json";

type BindValue = string | number | null | Uint8Array;

export function query(sql: string, ...values: BindValue[]): SqlQuery {
  return {
    sql,
    params: values.map((value) =>
      value instanceof Uint8Array ? { blob: Buffer.from(value).toString("base64") } : value,
    ),
  };
}

export abstract class AppDatabase {
  abstract batch(queries: SqlQuery[]): Promise<SqlResult[]>;
  abstract close(): void;

  async exec(sql: string) {
    const statements = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    if (statements.length) await this.batch(statements.map((statement) => query(statement)));
  }

  prepare(sql: string) {
    return {
      all: async <T>(...values: BindValue[]): Promise<T[]> => {
        const [result] = await this.batch([query(sql, ...values)]);
        return result.rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              isBlobParameter(value) ? Uint8Array.from(Buffer.from(value.blob, "base64")) : value,
            ]),
          ),
        ) as T[];
      },
      get: async <T>(...values: BindValue[]): Promise<T | undefined> => {
        const rows = await this.prepare(sql).all<T>(...values);
        return rows[0];
      },
      run: async (...values: BindValue[]) => {
        const [result] = await this.batch([query(sql, ...values)]);
        return { changes: result.changes };
      },
    };
  }
}

export class SqliteDatabase extends AppDatabase {
  readonly sqlite: DatabaseSync;

  constructor(file: string) {
    super();
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.sqlite = new DatabaseSync(file);
    if (file !== ":memory:") chmodSync(file, 0o600);
    this.sqlite.exec(
      "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON",
    );
  }

  async batch(queries: SqlQuery[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = queries.map(({ sql, params }) => {
        const statement = this.sqlite.prepare(sql);
        const values = params.map((value) =>
          isBlobParameter(value) ? Buffer.from(value.blob, "base64") : value,
        );
        const before = Number(
          this.sqlite.prepare("SELECT total_changes() AS changes").get()!.changes,
        );
        const rows = statement
          .all(...values)
          .map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([key, value]) => [
                key,
                value instanceof Uint8Array
                  ? { blob: Buffer.from(value).toString("base64") }
                  : value,
              ]),
            ),
          );
        const after = Number(
          this.sqlite.prepare("SELECT total_changes() AS changes").get()!.changes,
        );
        return { rows, changes: after - before } as SqlResult;
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.sqlite.close();
  }
}

export class D1Database extends AppDatabase {
  constructor(
    private readonly url: string,
    private readonly secret: string,
  ) {
    super();
  }

  async batch(batch: SqlQuery[]) {
    const { data } = await fetchJson<JsonValue>(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ batch }),
      name: "Database",
      timeoutMs: 15_000,
      maxBytes: 16 * 1_024 * 1_024,
    });
    if (!isSqlResults(data) || data.length !== batch.length)
      throw new UpstreamError("Database returned invalid results");
    return data;
  }

  close() {}
}
