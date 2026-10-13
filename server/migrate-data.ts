import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { importSnapshot, readSnapshot } from "./data-import";
import { D1Database } from "./database";

async function main() {
  const args = process.argv.slice(2);
  const fromIndex = args.indexOf("--from");
  if (fromIndex < 0 || !args[fromIndex + 1]) throw new Error("Use --from /path/to/data [--apply]");
  const snapshot = readSnapshot(resolve(args[fromIndex + 1]));
  console.log(
    JSON.stringify({
      tables: snapshot.tables.map((table) => ({ name: table.name, rows: table.rows.length })),
      apply: args.includes("--apply"),
    }),
  );
  if (!args.includes("--apply")) return;
  const url = process.env.D1_DATABASE_URL;
  const secret = process.env.D1_DATABASE_SECRET;
  if (
    !url ||
    !secret ||
    (process.env.NODE_ENV === "production" && new URL(url).protocol !== "https:")
  )
    throw new Error("Configure the private D1 database URL and secret before applying an import");
  const schema = await readFile(
    resolve(process.env.D1_SCHEMA_PATH || "migrations/0001_app.sql"),
    "utf8",
  );
  await importSnapshot(new D1Database(url, secret), snapshot, schema);
  console.log("All persistent app data imported and verified");
}

void main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
