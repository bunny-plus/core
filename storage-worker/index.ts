import type { D1Database } from "@cloudflare/workers-types";
import {
  isBlobParameter,
  isQueryBatch,
  type SqlParameter,
  type SqlResult,
} from "../shared/database";
import type { JsonValue } from "../shared/json";

type Env = { db: D1Database; DATABASE_SECRET: string };
type D1Value = string | number | null | number[] | ArrayBuffer;
type D1Row = { [column: string]: D1Value };

function blobBytes(value: { blob: string }) {
  return Uint8Array.from(atob(value.blob), (character) => character.charCodeAt(0)).buffer;
}

function encodeValue(value: D1Value): SqlParameter {
  if (Array.isArray(value) || value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value);
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 4_096)
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 4_096)));
    return { blob: btoa(chunks.join("")) };
  }
  return value;
}

async function authorized(request: Request, secret: string) {
  const supplied = request.headers.get("Authorization") || "";
  const encoder = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${secret}`)),
  ]);
  const expectedBytes = new Uint8Array(expected);
  return (
    new Uint8Array(actual).reduce(
      (difference, byte, index) => difference | (byte ^ expectedBytes[index]),
      0,
    ) === 0
  );
}

export default {
  async fetch(request: Request, env: Env) {
    const headers = { "Cache-Control": "private, no-store" };
    if (new URL(request.url).pathname !== "/query" || request.method !== "POST")
      return Response.json({ error: "Not found" }, { status: 404, headers });
    if (!env.DATABASE_SECRET || env.DATABASE_SECRET.length < 32 || !env.db)
      return Response.json({ error: "Database unavailable" }, { status: 503, headers });
    if (!(await authorized(request, env.DATABASE_SECRET)))
      return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    if (request.headers.get("Content-Type")?.split(";", 1)[0] !== "application/json")
      return Response.json({ error: "Expected JSON" }, { status: 415, headers });
    try {
      const body: JsonValue = await request.json();
      if (!isQueryBatch(body))
        return Response.json({ error: "Invalid query batch" }, { status: 400, headers });
      const statements = body.batch.map(({ sql, params }) =>
        env.db
          .prepare(sql)
          .bind(...params.map((value) => (isBlobParameter(value) ? blobBytes(value) : value))),
      );
      // D1 batches commit together or roll back on failure, including conditional login redemption.
      const results = await env.db.batch<D1Row>(statements);
      const response: SqlResult[] = results.map((result) => ({
        changes: result.meta.changes,
        rows: result.results.map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([column, value]) => [column, encodeValue(value)]),
          ),
        ),
      }));
      return Response.json(response, { headers });
    } catch {
      // Database errors can contain private parameters. Keep the public response generic.
      return Response.json({ error: "Database query failed" }, { status: 503, headers });
    }
  },
};
