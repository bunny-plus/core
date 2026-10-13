import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import WebSocket, { WebSocketServer, type RawData } from "ws";

import { ChatHistory } from "./chat-history";
import { CinemaDiary } from "./cinema";
import { WatchRoom } from "./room";
import { generateTicketBunny } from "../shared/ticket-bunny";

const startTime = Date.parse("2026-09-30T17:00:00.000Z");

async function watchFor(
  diary: CinemaDiary,
  memberId: string,
  screeningId: string,
  seconds: number,
  start = startTime,
) {
  await diary.watching(memberId, memberId, screeningId, true, start);
  for (let elapsed = 10; elapsed <= seconds; elapsed += 10)
    await diary.watching(memberId, memberId, screeningId, true, start + elapsed * 1000);
}

test("tickets require ten minutes of playback and are issued only once", async () => {
  const diary = new CinemaDiary(":memory:");
  try {
    const screening = await diary.start("Perfect Blue", startTime);
    assert.ok(await diary.createTicket(screening.id, "Perfect Blue", null, startTime));
    await watchFor(diary, "viewer", screening.id, 590);
    assert.equal((await diary.progress("viewer")).watchedSeconds, 590);
    assert.equal((await diary.progress("viewer")).ticket, null);
    const earned = await diary.watching("viewer", "viewer", screening.id, true, startTime + 600000);
    assert.equal(earned.watchedSeconds, 600);
    assert.equal(earned.ticket?.number, 1);
    assert.equal(earned.ticket?.title, "Perfect Blue");
    assert.equal(earned.ticket?.screenedAt, screening.startedAt);
    assert.equal(earned.ticket?.earnedAt, new Date(startTime + 600000).toISOString());
    for (let elapsed = 610; elapsed <= 660; elapsed += 10)
      await diary.watching("viewer", "viewer", screening.id, true, startTime + elapsed * 1000);
    assert.equal((await diary.collection("viewer")).total, 1);
    assert.deepEqual((await diary.progress("viewer")).ticket, earned.ticket);
    assert.equal((await diary.progress("viewer")).watchedSeconds, 600);
  } finally {
    diary.close();
  }
});

test("pauses, long gaps, and stale screening IDs cannot earn viewing time", async () => {
  const diary = new CinemaDiary(":memory:");
  try {
    const screening = await diary.start("A livestream", startTime);
    await diary.watching("viewer", "tab", screening.id, true, startTime);
    await diary.watching("viewer", "tab", screening.id, true, startTime + 10000);
    await diary.watching("viewer", "tab", screening.id, false, startTime + 20000);
    await diary.watching("viewer", "tab", screening.id, true, startTime + 300000);
    await diary.watching("viewer", "tab", screening.id, true, startTime + 310000);
    await diary.watching("viewer", "tab", screening.id, true, startTime + 341000);
    assert.equal((await diary.progress("viewer")).watchedSeconds, 20);
    await diary.watching("viewer", "tab", screening.id, true, startTime + 351000);
    assert.equal((await diary.progress("viewer")).watchedSeconds, 30);
    const next = await diary.start("Another livestream", startTime + 360000);
    await diary.watching("viewer", "tab", screening.id, true, startTime + 370000);
    assert.equal((await diary.progress("viewer")).watchedSeconds, 0);
    await diary.watching("viewer", "tab", next.id, true, startTime + 380000);
    await diary.watching("viewer", "tab", next.id, true, startTime + 390000);
    assert.equal((await diary.progress("viewer")).watchedSeconds, 10);
    await diary.stop(startTime + 400000);
    assert.equal(
      (await diary.watching("viewer", "tab", next.id, true, startTime + 410000)).screening,
      null,
    );
    assert.equal((await diary.collection("viewer")).total, 0);
  } finally {
    diary.close();
  }
});

test("overlapping tabs count the union of playback intervals", async () => {
  const diary = new CinemaDiary(":memory:");
  try {
    const screening = await diary.start("Together", startTime);
    await diary.watching("viewer", "a", screening.id, true, startTime);
    await diary.watching("viewer", "b", screening.id, true, startTime + 5000);
    await diary.watching("viewer", "a", screening.id, true, startTime + 10000);
    await diary.watching("viewer", "b", screening.id, true, startTime + 15000);
    assert.equal((await diary.progress("viewer")).watchedSeconds, 15);
    await diary.watching("viewer", "a", screening.id, false, startTime + 20000);
    await diary.watching("viewer", "b", screening.id, true, startTime + 25000);
    diary.disconnect("a");
    await diary.watching("viewer", "b", screening.id, true, startTime + 35000);
    assert.equal((await diary.progress("viewer")).watchedSeconds, 35);
    await diary.watching("other-viewer", "c", screening.id, true, startTime + 35000);
    await diary.watching("other-viewer", "c", screening.id, true, startTime + 45000);
    assert.equal((await diary.progress("other-viewer")).watchedSeconds, 10);
    assert.equal((await diary.progress("viewer")).watchedSeconds, 35);
  } finally {
    diary.close();
  }
});

test("idle relay pulses cannot earn tickets and recovery excludes the outage", async () => {
  const diary = new CinemaDiary(":memory:");
  try {
    const screening = await diary.start("Together", startTime);
    await diary.createTicket(screening.id, "Together", null, startTime);
    await watchFor(diary, "viewer", screening.id, 590);
    assert.deepEqual(await diary.observe(false, null), await diary.current());
    await watchFor(diary, "viewer", screening.id, 60, startTime + 590000);
    assert.equal((await diary.progress("viewer")).watchedSeconds, 590);
    assert.equal((await diary.collection("viewer")).total, 0);
    await diary.observe(true, "Together");
    await diary.watching("viewer", "viewer", screening.id, true, startTime + 660000);
    assert.equal((await diary.progress("viewer")).watchedSeconds, 590);
    await diary.watching("viewer", "viewer", screening.id, true, startTime + 670000);
    assert.equal((await diary.progress("viewer")).ticket?.number, 1);
  } finally {
    diary.close();
  }
});

test("stopping ticket counting survives restarts and preserves progress, tickets, and artwork", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-cinema-counting-"));
  const file = join(directory, "cinema.sqlite");
  const diary = new CinemaDiary(file);
  const screening = await diary.start("Together", startTime);
  const image = { mimeType: "image/png", data: new Uint8Array([1, 2, 3]) };
  await diary.createTicket(screening.id, "Collectible", image, startTime);
  await watchFor(diary, "collector", screening.id, 600);
  await watchFor(diary, "viewer", screening.id, 590);
  const collected = await diary.collection("collector");
  const stopped = await diary.setTicketCounting(screening.id, false);
  assert.equal(stopped?.ticketCountingEnabled, false);
  // Even a stop/resume entirely between pulses must exclude that interval.
  await diary.setTicketCounting(screening.id, true);
  await diary.watching("viewer", "viewer", screening.id, true, startTime + 600000);
  assert.equal((await diary.progress("viewer")).watchedSeconds, 590);
  await diary.setTicketCounting(screening.id, false);
  diary.close();
  const restored = new CinemaDiary(file);
  try {
    assert.equal((await restored.current())?.ticketCountingEnabled, false);
    await restored.observe(true, "Together");
    await watchFor(restored, "viewer", screening.id, 60, startTime + 610000);
    assert.equal((await restored.progress("viewer")).watchedSeconds, 590);
    assert.equal((await restored.progress("viewer")).ticket, null);
    assert.deepEqual(await restored.collection("collector"), collected);
    assert.deepEqual(await restored.image(screening.id), image);
    await restored.setTicketCounting(screening.id, true);
    await restored.watching("viewer", "viewer", screening.id, true, startTime + 680000);
    assert.equal((await restored.progress("viewer")).watchedSeconds, 590);
    await restored.watching("viewer", "viewer", screening.id, true, startTime + 690000);
    assert.equal((await restored.progress("viewer")).ticket?.title, "Collectible");
    await restored.setTicketCounting(screening.id, false);
    const next = await restored.start("Next screening", startTime + 700000);
    assert.equal(next.ticketCountingEnabled, true);
    assert.equal(await restored.setTicketCounting(screening.id, false), null);
    assert.deepEqual(await restored.current(), next);
  } finally {
    restored.close();
  }
});

test("a later tab can fill a gap without counting already covered time twice", async () => {
  const diary = new CinemaDiary(":memory:");
  try {
    const screening = await diary.start("Together", startTime);
    await diary.watching("viewer", "a", screening.id, true, startTime);
    await diary.watching("viewer", "a", screening.id, true, startTime + 10000);
    await diary.watching("viewer", "a", screening.id, false, startTime + 11000);
    await diary.watching("viewer", "b", screening.id, true, startTime + 15000);
    await diary.watching("viewer", "a", screening.id, true, startTime + 20000);
    await diary.watching("viewer", "a", screening.id, true, startTime + 30000);
    await diary.watching("viewer", "b", screening.id, true, startTime + 31000);
    assert.equal((await diary.progress("viewer")).watchedSeconds, 26);
  } finally {
    diary.close();
  }
});

test("reconnect and process restart retain totals without counting disconnected time", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-cinema-"));
  const file = join(directory, "cinema.sqlite");
  const original = new CinemaDiary(file);
  const screening = await original.createTicket(
    (await original.start("Perfect Blue", startTime)).id,
    "Perfect Blue",
    null,
    startTime,
  );
  assert.ok(screening);
  await watchFor(original, "viewer", screening.id, 300);
  original.disconnect("viewer");
  await original.watching("viewer", "new-tab", screening.id, true, startTime + 310000);
  assert.equal((await original.progress("viewer")).watchedSeconds, 300);
  await original.watching("viewer", "new-tab", screening.id, true, startTime + 320000);
  original.close();
  const restored = new CinemaDiary(file);
  try {
    assert.deepEqual(await restored.current(), screening);
    await watchFor(restored, "viewer", screening.id, 10, startTime + 320000);
    assert.equal((await restored.progress("viewer")).watchedSeconds, 310);
    assert.deepEqual(await restored.observe(true, "Perfect Blue"), screening);
    assert.equal((await restored.progress("viewer")).watchedSeconds, 310);
    await restored.watching("viewer", "new-tab", screening.id, true, startTime + 330000);
    assert.equal((await restored.progress("viewer")).watchedSeconds, 310);
    await watchFor(restored, "viewer", screening.id, 290, startTime + 340000);
    assert.equal((await restored.progress("viewer")).ticket?.number, 1);
  } finally {
    restored.close();
  }
  const reopened = new CinemaDiary(file);
  try {
    assert.equal((await reopened.collection("viewer")).total, 1);
    assert.equal((await reopened.progress("viewer")).ticket?.number, 1);
  } finally {
    reopened.close();
  }
});

test("repeat starts create collectible screenings while temporary outages keep the current one", async () => {
  const diary = new CinemaDiary(":memory:");
  try {
    assert.equal(await diary.observe(false, null), null);
    const adopted = await diary.observe(true, "Perfect Blue");
    assert.ok(adopted);
    assert.deepEqual(await diary.observe(false, null), adopted);
    assert.deepEqual(await diary.observe(true, "Perfect Blue"), adopted);
    const changed = await diary.observe(true, "Paprika");
    assert.notEqual(changed?.id, adopted.id);
    const first = await diary.start("Perfect Blue", startTime);
    assert.ok(await diary.createTicket(first.id, "Perfect Blue", null, startTime));
    await watchFor(diary, "viewer", first.id, 600);
    const second = await diary.start("Perfect Blue", startTime + 700000);
    assert.ok(await diary.createTicket(second.id, "Perfect Blue", null, startTime + 700000));
    assert.notEqual(first.id, second.id);
    await watchFor(diary, "viewer", second.id, 600, startTime + 700000);
    const collection = await diary.collection("viewer");
    assert.equal(collection.total, 2);
    assert.deepEqual(
      collection.tickets.map((ticket) => ticket.number),
      [2, 1],
    );
    assert.deepEqual(
      collection.tickets.map((ticket) => ticket.screeningId),
      [second.id, first.id],
    );
    assert.deepEqual(await diary.collection("someone-else"), { tickets: [], total: 0 });
  } finally {
    diary.close();
  }
});

test("collections are bounded while total and ticket numbering remain accurate", async () => {
  const diary = new CinemaDiary(":memory:");
  try {
    for (let index = 0; index < 102; index += 1) {
      const at = startTime + index * 700000;
      const screening = await diary.start(`Screening ${index}`, at);
      assert.ok(await diary.createTicket(screening.id, screening.title, null, at));
      await watchFor(diary, "viewer", screening.id, 600, at);
    }
    const collection = await diary.collection("viewer");
    assert.equal(collection.total, 102);
    assert.equal(collection.tickets.length, 100);
    assert.equal(collection.tickets[0].number, 102);
    assert.equal(collection.tickets[99].number, 3);
  } finally {
    diary.close();
  }
});

test("a failed write does not mark unpersisted playback as already counted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-cinema-lock-"));
  const file = join(directory, "cinema.sqlite");
  const diary = new CinemaDiary(file);
  const competing = new DatabaseSync(file);
  try {
    const screening = await diary.start("Together", startTime);
    await diary.watching("viewer", "tab", screening.id, true, startTime);
    competing.exec("BEGIN IMMEDIATE");
    await assert.rejects(
      async () => await diary.watching("viewer", "tab", screening.id, true, startTime + 10000),
    );
    assert.equal((await diary.progress("viewer")).watchedSeconds, 0);
    competing.exec("COMMIT");
    await diary.watching("viewer", "tab", screening.id, true, startTime + 20000);
    assert.equal((await diary.progress("viewer")).watchedSeconds, 20);
  } finally {
    competing.close();
    diary.close();
  }
});

test("watching without a design saves progress and late creation awards every eligible viewer once", async () => {
  const diary = new CinemaDiary(":memory:");
  try {
    const screening = await diary.start("Livestream", startTime);
    assert.equal(screening.ticketDesign, null);
    await watchFor(diary, "first", screening.id, 600);
    await watchFor(diary, "second", screening.id, 600);
    await watchFor(diary, "almost", screening.id, 590);
    assert.equal((await diary.progress("first")).watchedSeconds, 600);
    assert.equal((await diary.progress("first")).ticket, null);
    assert.equal((await diary.collection("first")).total, 0);
    await diary.watching("first", "first", screening.id, false, startTime + 610000);
    const designed = await diary.createTicket(
      screening.id,
      "The burrow's premiere",
      null,
      startTime + 620000,
    );
    assert.ok(designed);
    assert.deepEqual(designed.ticketDesign, {
      title: "The burrow's premiere",
      imagePath: null,
      createdAt: new Date(startTime + 620000).toISOString(),
    });
    for (const member of ["first", "second"]) {
      assert.equal((await diary.progress(member)).ticket?.title, "The burrow's premiere");
      assert.equal((await diary.collection(member)).total, 1);
    }
    assert.equal((await diary.progress("almost")).ticket, null);
    assert.equal(await diary.createTicket(screening.id, "Replacement", null), null);
    assert.equal((await diary.collection("first")).total, 1);
    await diary.watching("almost", "almost", screening.id, true, startTime + 600000);
    assert.equal((await diary.progress("almost")).ticket?.number, 1);
    const next = await diary.start("Next livestream", startTime + 700000);
    assert.equal(next.ticketDesign, null);
    assert.equal(await diary.createTicket(screening.id, "Old draft", null), null);
    assert.equal((await diary.current())?.ticketDesign, null);
  } finally {
    diary.close();
  }
});

test("design images and immutable earned artwork survive restart and screening changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-cinema-image-"));
  const file = join(directory, "cinema.sqlite");
  const diary = new CinemaDiary(file);
  const screening = await diary.start("Stream title", startTime);
  const image = { mimeType: "image/png", data: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]) };
  const designed = await diary.createTicket(screening.id, "Collectible title", image, startTime);
  assert.ok(designed);
  await watchFor(diary, "viewer", screening.id, 600);
  const ticket = (await diary.progress("viewer")).ticket;
  assert.ok(ticket);
  assert.equal(ticket.title, "Collectible title");
  assert.equal(ticket.imagePath, `/api/cinema/screenings/${screening.id}/image`);
  diary.close();
  const restored = new CinemaDiary(file);
  try {
    assert.deepEqual(await restored.current(), designed);
    assert.deepEqual(await restored.image(screening.id), image);
    assert.equal(await restored.createTicket(screening.id, "Changed title", null), null);
    await restored.start("Next stream", startTime + 700000);
    assert.deepEqual((await restored.collection("viewer")).tickets, [ticket]);
    assert.deepEqual(await restored.image(screening.id), image);
  } finally {
    restored.close();
  }
});

test("migration preserves legacy tickets even when a design is later added to their screening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-cinema-migration-"));
  const file = join(directory, "cinema.sqlite");
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    CREATE TABLE cinema_screenings (id TEXT PRIMARY KEY, title TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT) STRICT;
    CREATE TABLE cinema_progress (member_id TEXT NOT NULL, screening_id TEXT NOT NULL, watched_ms INTEGER NOT NULL, PRIMARY KEY (member_id, screening_id)) STRICT;
    CREATE TABLE cinema_tickets (id TEXT PRIMARY KEY, member_id TEXT NOT NULL, screening_id TEXT NOT NULL, earned_at TEXT NOT NULL, number INTEGER NOT NULL, UNIQUE (member_id, screening_id), UNIQUE (member_id, number)) STRICT;
    INSERT INTO cinema_screenings VALUES ('legacy-screening', 'Original title', '2026-09-29T17:00:00.000Z', NULL);
    INSERT INTO cinema_progress VALUES ('legacy-viewer', 'legacy-screening', 600000);
    INSERT INTO cinema_tickets VALUES ('legacy-ticket', 'legacy-viewer', 'legacy-screening', '2026-09-29T17:10:00.000Z', 7);
  `);
  legacy.close();
  const diary = new CinemaDiary(file);
  try {
    const expected = {
      id: "legacy-ticket",
      screeningId: "legacy-screening",
      title: "Original title",
      screenedAt: "2026-09-29T17:00:00.000Z",
      earnedAt: "2026-09-29T17:10:00.000Z",
      number: 7,
      imagePath: null,
      bunny: generateTicketBunny("legacy-screening"),
    };
    assert.equal((await diary.current())?.ticketDesign, null);
    assert.deepEqual((await diary.collection("legacy-viewer")).tickets, [expected]);
    await diary.createTicket("legacy-screening", "New artwork title", null, startTime);
    assert.deepEqual((await diary.collection("legacy-viewer")).tickets, [expected]);
    const next = await diary.start("New stream", startTime);
    await diary.createTicket(next.id, "New ticket", null, startTime);
    await watchFor(diary, "legacy-viewer", next.id, 600);
    assert.equal((await diary.progress("legacy-viewer")).ticket?.number, 8);
    assert.deepEqual((await diary.collection("legacy-viewer")).tickets[1], expected);
  } finally {
    diary.close();
  }
});

function isAddressInfo(address: AddressInfo | string | null): address is AddressInfo {
  return address !== null && typeof address !== "string";
}

function nextCinemaMessage(socket: WebSocket) {
  return new Promise<string>((resolve) => {
    function message(data: RawData) {
      const text = data.toString();
      if (JSON.parse(text).type !== "cinema-progress") return;
      socket.off("message", message);
      resolve(text);
    }
    socket.on("message", message);
  });
}

test(
  "the room welcomes viewers with progress and counts only valid playing pulses",
  { timeout: 5000 },
  async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "bunny-cinema-room-"));
    const diary = new CinemaDiary(join(directory, "cinema.sqlite"));
    const chats = new ChatHistory(join(directory, "chat.sqlite"), 200);
    const room = new WatchRoom(chats, diary);
    const server = createServer();
    const webSockets = new WebSocketServer({ server });
    let now = startTime;
    context.mock.method(Date, "now", () => now);
    webSockets.on("connection", (socket) =>
      room.connect(
        socket,
        {
          admin: false,
          avatar: null,
          id: "viewer",
          name: "Viewer",
        },
        startTime + 3600000,
      ),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(isAddressInfo(address));
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
    try {
      const welcome = JSON.parse(await nextCinemaMessage(socket));
      assert.deepEqual(welcome, {
        type: "cinema-progress",
        progress: { screening: null, watchedSeconds: 0, requiredSeconds: 600, ticket: null },
      });
      const screening = await diary.start("Together", now);
      const discovered = nextCinemaMessage(socket);
      socket.send(JSON.stringify({ type: "watching", screeningId: "", playing: false }));
      assert.deepEqual(JSON.parse(await discovered).progress.screening, screening);
      const first = nextCinemaMessage(socket);
      socket.send(
        JSON.stringify({
          type: "watching",
          screeningId: screening.id,
          playing: true,
          elapsed: 600,
        }),
      );
      assert.equal(JSON.parse(await first).progress.watchedSeconds, 0);
      now += 10000;
      const second = nextCinemaMessage(socket);
      socket.send(JSON.stringify({ type: "watching", screeningId: screening.id, playing: true }));
      assert.equal(JSON.parse(await second).progress.watchedSeconds, 10);
      now += 10000;
      const paused = nextCinemaMessage(socket);
      socket.send(JSON.stringify({ type: "watching", screeningId: screening.id, playing: false }));
      assert.equal(JSON.parse(await paused).progress.watchedSeconds, 10);
      const stale = nextCinemaMessage(socket);
      socket.send(
        JSON.stringify({ type: "watching", screeningId: "another-screening", playing: true }),
      );
      assert.equal(JSON.parse(await stale).progress.watchedSeconds, 10);
      assert.equal((await diary.collection("viewer")).total, 0);
    } finally {
      socket.terminate();
      for (const connection of webSockets.clients) connection.terminate();
      await new Promise<void>((resolve) => webSockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      chats.close();
      diary.close();
    }
  },
);
