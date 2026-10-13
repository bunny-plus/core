import type { JsonObject, JsonValue } from "../server/upstream";

export type SqlParameter = string | number | null | { blob: string };
export type SqlRow = { [column: string]: SqlParameter };
export type SqlQuery = { sql: string; params: SqlParameter[] };
export type SqlResult = { rows: SqlRow[]; changes: number };

function isSqlParameter(value: JsonValue): value is SqlParameter {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "object" &&
      value !== null &&
      "blob" in value &&
      typeof value.blob === "string" &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(value.blob))
  );
}

function isSqlQuery(value: JsonValue): value is SqlQuery {
  return (
    typeof value === "object" &&
    value !== null &&
    "sql" in value &&
    typeof value.sql === "string" &&
    value.sql.length > 0 &&
    new TextEncoder().encode(value.sql).byteLength <= 100_000 &&
    "params" in value &&
    Array.isArray(value.params) &&
    value.params.length <= 100 &&
    value.params.every(isSqlParameter)
  );
}

export function isQueryBatch(value: JsonValue): value is { batch: SqlQuery[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "batch" in value &&
    Array.isArray(value.batch) &&
    value.batch.length > 0 &&
    value.batch.length <= 50 &&
    value.batch.every(isSqlQuery)
  );
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSqlRow(value: JsonValue): value is SqlRow {
  return isJsonObject(value) && Object.values(value).every(isSqlParameter);
}

function isSqlResult(value: JsonValue): value is SqlResult {
  return (
    isJsonObject(value) &&
    typeof value.changes === "number" &&
    Number.isSafeInteger(value.changes) &&
    value.changes >= 0 &&
    Array.isArray(value.rows) &&
    value.rows.every(isSqlRow)
  );
}

export function isSqlResults(value: JsonValue): value is SqlResult[] {
  return Array.isArray(value) && value.every(isSqlResult);
}

export function isBlobParameter(value: SqlParameter): value is { blob: string } {
  return value !== null && typeof value === "object";
}
