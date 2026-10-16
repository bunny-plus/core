import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

import { AuthSessions } from "./auth-sessions";
import type { RoomChat } from "../shared/room";
import { ChatHistory } from "./chat-history";
import { CinemaDiary } from "./cinema";
import { D1Database, query } from "./database";

const secret = "a".repeat(43);
const viewer = { id: "bunny", name: "Bunny", avatar: null, admin: false, permissions: [] };

async function storage(context: TestContext) {
  const bundled = await build({
    entryPoints: ["storage-worker/index.ts"],
    bundle: true,
    format: "esm",
    write: false,
  });
  const worker = new Miniflare({
    modules: true,
    script: bundled.outputFiles[0].text,
    compatibilityDate: "2026-07-30",
    d1Databases: ["db"],
    bindings: { DATABASE_SECRET: secret },
  });
  context.after(() => worker.dispose());
  const url = new URL("/query", await worker.ready).toString();
  return { worker, url, database: new D1Database(url, secret) };
}

function chat(index: number): RoomChat {
  return {
    id: `chat-${index}`,
    createdAt: new Date(index * 1_000).toISOString(),
    member: { id: viewer.id, name: viewer.name, admin: viewer.admin, avatar: viewer.avatar },
    message: `Message ${index}`,
    type: "chat",
    x: 50,
  };
}

test("the D1 Worker keeps database access private and rolls back failed batches", async (context) => {
  const { url, database } = await storage(context);
  const body = JSON.stringify({ batch: [query("SELECT 1")] });
  assert.equal((await fetch(url, { method: "POST", body })).status, 401);
  assert.equal((await fetch(url, { method: "GET" })).status, 404);
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "text/plain" },
        body,
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ batch: Array.from({ length: 51 }, () => query("SELECT 1")) }),
      })
    ).status,
    400,
  );
  await database.exec("CREATE TABLE entries (id TEXT PRIMARY KEY) STRICT");
  await assert.rejects(
    database.batch([
      query("INSERT INTO entries VALUES (?)", "private-value"),
      query("INSERT INTO entries VALUES (?)", "private-value"),
    ]),
    /Database request failed/,
  );
  assert.equal(
    (await database.prepare("SELECT COUNT(*) AS total FROM entries").get<{ total: number }>())
      ?.total,
    0,
  );
});

test("all app repositories work through D1, including concurrent login redemption and image blobs", async (context) => {
  const { database } = await storage(context);
  const sessions = new AuthSessions(database);
  const chats = new ChatHistory(database, 2);
  const cinema = new CinemaDiary(database);
  await Promise.all([sessions.ready, chats.ready, cinema.ready]);
  const login = await sessions.issueLoginLink(viewer.id);
  const redeemed = await Promise.all(
    Array.from({ length: 3 }, () => sessions.redeemLoginLink(login, viewer)),
  );
  assert.equal(redeemed.filter(Boolean).length, 1);
  const token = redeemed.find((value) => value !== null)!;
  assert.equal((await sessions.read(token))?.viewer.id, viewer.id);
  assert.equal((await sessions.read(token))?.credentials, null);
  await sessions.revoke(token);
  assert.equal(await sessions.read(token), null);
  for (let index = 1; index <= 3; index++) await chats.append(chat(index));
  assert.deepEqual(await chats.all(), [chat(2), chat(3)]);
  const screening = await cinema.start("Perfect Blue", 0);
  const image = { mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) };
  await cinema.createTicket(screening.id, "Perfect Blue", image, 0);
  await Promise.all([
    cinema.watching(viewer.id, "first-tab", screening.id, true, 0),
    cinema.watching(viewer.id, "second-tab", screening.id, true, 0),
  ]);
  for (let elapsed = 10_000; elapsed <= 600_000; elapsed += 10_000) {
    await Promise.all([
      cinema.watching(viewer.id, "first-tab", screening.id, true, elapsed),
      cinema.watching(viewer.id, "second-tab", screening.id, true, elapsed),
    ]);
  }
  assert.equal((await cinema.progress(viewer.id)).watchedSeconds, 600);
  assert.equal((await cinema.collection(viewer.id)).total, 1);
  assert.deepEqual(await cinema.image(screening.id), image);
  await cinema.setTicketCounting(screening.id, false);
  assert.equal((await new CinemaDiary(database).current())?.ticketCountingEnabled, false);
});

test("legacy cinema artwork migration fits the free Worker's batch limit", async (context) => {
  const { database } = await storage(context);
  const cinema = new CinemaDiary(database);
  const screening = await cinema.start("Legacy screening", 0);
  await database.batch([
    query("DELETE FROM cinema_ticket_migrations"),
    query(
      `INSERT INTO cinema_tickets (id, member_id, screening_id, earned_at, number)
      WITH RECURSIVE members(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM members WHERE n < 70)
      SELECT 'ticket-' || n, 'member-' || n, ?, '1970-01-01T00:00:00.000Z', 1 FROM members`,
      screening.id,
    ),
  ]);
  await new CinemaDiary(database).ready;
  assert.equal(
    (
      await database
        .prepare("SELECT COUNT(*) AS total FROM cinema_legacy_ticket_bunnies")
        .get<{ total: number }>()
    )?.total,
    70,
  );
  assert.equal(
    (
      await database
        .prepare("SELECT COUNT(*) AS total FROM cinema_ticket_migrations")
        .get<{ total: number }>()
    )?.total,
    1,
  );
});
