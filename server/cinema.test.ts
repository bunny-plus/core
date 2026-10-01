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

const startTime = Date.parse("2026-09-30T17:00:00.000Z");

function watchFor(
  diary: CinemaDiary,
  memberId: string,
  screeningId: string,
  seconds: number,
  start = startTime,
) {
  diary.watching(memberId, memberId, screeningId, true, start);
  for (let elapsed = 10; elapsed <= seconds; elapsed += 10)
    diary.watching(memberId, memberId, screeningId, true, start + elapsed * 1_000);
}

test("tickets require ten minutes of playback and are issued only once", () => {
  const diary = new CinemaDiary(":memory:");
  try {
    const screening = diary.start("Perfect Blue", startTime);
    assert.ok(diary.createTicket(screening.id, "Perfect Blue", null, startTime));
    watchFor(diary, "viewer", screening.id, 590);
    assert.equal(diary.progress("viewer").watchedSeconds, 590);
    assert.equal(diary.progress("viewer").ticket, null);
    const earned = diary.watching("viewer", "viewer", screening.id, true, startTime + 600_000);
    assert.equal(earned.watchedSeconds, 600);
    assert.equal(earned.ticket?.number, 1);
    assert.equal(earned.ticket?.title, "Perfect Blue");
    assert.equal(earned.ticket?.screenedAt, screening.startedAt);
    assert.equal(earned.ticket?.earnedAt, new Date(startTime + 600_000).toISOString());
    for (let elapsed = 610; elapsed <= 660; elapsed += 10)
      diary.watching("viewer", "viewer", screening.id, true, startTime + elapsed * 1_000);
    assert.equal(diary.collection("viewer").total, 1);
    assert.deepEqual(diary.progress("viewer").ticket, earned.ticket);
    assert.equal(diary.progress("viewer").watchedSeconds, 600);
  } finally {
    diary.close();
  }
});

test("pauses, long gaps, and stale screening IDs cannot earn viewing time", () => {
  const diary = new CinemaDiary(":memory:");
  try {
    const screening = diary.start("A livestream", startTime);
    diary.watching("viewer", "tab", screening.id, true, startTime);
    diary.watching("viewer", "tab", screening.id, true, startTime + 10_000);
    diary.watching("viewer", "tab", screening.id, false, startTime + 20_000);
    diary.watching("viewer", "tab", screening.id, true, startTime + 300_000);
    diary.watching("viewer", "tab", screening.id, true, startTime + 310_000);
    diary.watching("viewer", "tab", screening.id, true, startTime + 341_000);
    assert.equal(diary.progress("viewer").watchedSeconds, 20);
    diary.watching("viewer", "tab", screening.id, true, startTime + 351_000);
    assert.equal(diary.progress("viewer").watchedSeconds, 30);
    const next = diary.start("Another livestream", startTime + 360_000);
    diary.watching("viewer", "tab", screening.id, true, startTime + 370_000);
    assert.equal(diary.progress("viewer").watchedSeconds, 0);
    diary.watching("viewer", "tab", next.id, true, startTime + 380_000);
    diary.watching("viewer", "tab", next.id, true, startTime + 390_000);
    assert.equal(diary.progress("viewer").watchedSeconds, 10);
    diary.stop(startTime + 400_000);
    assert.equal(
      diary.watching("viewer", "tab", next.id, true, startTime + 410_000).screening,
      null,
    );
    assert.equal(diary.collection("viewer").total, 0);
  } finally {
    diary.close();
  }
});

test("overlapping tabs count the union of playback intervals", () => {
  const diary = new CinemaDiary(":memory:");
  try {
    const screening = diary.start("Together", startTime);
    diary.watching("viewer", "a", screening.id, true, startTime);
    diary.watching("viewer", "b", screening.id, true, startTime + 5_000);
    diary.watching("viewer", "a", screening.id, true, startTime + 10_000);
    diary.watching("viewer", "b", screening.id, true, startTime + 15_000);
    assert.equal(diary.progress("viewer").watchedSeconds, 15);
    diary.watching("viewer", "a", screening.id, false, startTime + 20_000);
    diary.watching("viewer", "b", screening.id, true, startTime + 25_000);
    diary.disconnect("a");
    diary.watching("viewer", "b", screening.id, true, startTime + 35_000);
    assert.equal(diary.progress("viewer").watchedSeconds, 35);
    diary.watching("other-viewer", "c", screening.id, true, startTime + 35_000);
    diary.watching("other-viewer", "c", screening.id, true, startTime + 45_000);
    assert.equal(diary.progress("other-viewer").watchedSeconds, 10);
    assert.equal(diary.progress("viewer").watchedSeconds, 35);
  } finally {
    diary.close();
  }
});

test("a later tab can fill a gap without counting already covered time twice", () => {
  const diary = new CinemaDiary(":memory:");
  try {
    const screening = diary.start("Together", startTime);
    diary.watching("viewer", "a", screening.id, true, startTime);
    diary.watching("viewer", "a", screening.id, true, startTime + 10_000);
    diary.watching("viewer", "a", screening.id, false, startTime + 11_000);
    diary.watching("viewer", "b", screening.id, true, startTime + 15_000);
    diary.watching("viewer", "a", screening.id, true, startTime + 20_000);
    diary.watching("viewer", "a", screening.id, true, startTime + 30_000);
    diary.watching("viewer", "b", screening.id, true, startTime + 31_000);
    assert.equal(diary.progress("viewer").watchedSeconds, 26);
  } finally {
    diary.close();
  }
});

test("reconnect and process restart retain totals without counting disconnected time", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-cinema-"));
  const file = join(directory, "cinema.sqlite");
  const original = new CinemaDiary(file);
  const screening = original.createTicket(
    original.start("Perfect Blue", startTime).id,
    "Perfect Blue",
    null,
    startTime,
  );
  assert.ok(screening);
  watchFor(original, "viewer", screening.id, 300);
  original.disconnect("viewer");
  original.watching("viewer", "new-tab", screening.id, true, startTime + 310_000);
  assert.equal(original.progress("viewer").watchedSeconds, 300);
  original.watching("viewer", "new-tab", screening.id, true, startTime + 320_000);
  original.close();
  const restored = new CinemaDiary(file);
  try {
    assert.deepEqual(restored.current(), screening);
    assert.deepEqual(restored.observe(true, "Perfect Blue"), screening);
    assert.equal(restored.progress("viewer").watchedSeconds, 310);
    restored.watching("viewer", "new-tab", screening.id, true, startTime + 330_000);
    assert.equal(restored.progress("viewer").watchedSeconds, 310);
    watchFor(restored, "viewer", screening.id, 290, startTime + 340_000);
    assert.equal(restored.progress("viewer").ticket?.number, 1);
  } finally {
    restored.close();
  }
  const reopened = new CinemaDiary(file);
  try {
    assert.equal(reopened.collection("viewer").total, 1);
    assert.equal(reopened.progress("viewer").ticket?.number, 1);
  } finally {
    reopened.close();
  }
});

test("repeat starts create collectible screenings while temporary outages keep the current one", () => {
  const diary = new CinemaDiary(":memory:");
  try {
    assert.equal(diary.observe(false, null), null);
    const adopted = diary.observe(true, "Perfect Blue");
    assert.ok(adopted);
    assert.deepEqual(diary.observe(false, null), adopted);
    assert.deepEqual(diary.observe(true, "Perfect Blue"), adopted);
    const changed = diary.observe(true, "Paprika");
    assert.notEqual(changed?.id, adopted.id);
    const first = diary.start("Perfect Blue", startTime);
    assert.ok(diary.createTicket(first.id, "Perfect Blue", null, startTime));
    watchFor(diary, "viewer", first.id, 600);
    const second = diary.start("Perfect Blue", startTime + 700_000);
    assert.ok(diary.createTicket(second.id, "Perfect Blue", null, startTime + 700_000));
    assert.notEqual(first.id, second.id);
    watchFor(diary, "viewer", second.id, 600, startTime + 700_000);
    const collection = diary.collection("viewer");
    assert.equal(collection.total, 2);
    assert.deepEqual(
      collection.tickets.map((ticket) => ticket.number),
      [2, 1],
    );
    assert.deepEqual(
      collection.tickets.map((ticket) => ticket.screeningId),
      [second.id, first.id],
    );
    assert.deepEqual(diary.collection("someone-else"), { tickets: [], total: 0 });
  } finally {
    diary.close();
  }
});

test("collections are bounded while total and ticket numbering remain accurate", () => {
  const diary = new CinemaDiary(":memory:");
  try {
    for (let index = 0; index < 102; index += 1) {
      const at = startTime + index * 700_000;
      const screening = diary.start(`Screening ${index}`, at);
      assert.ok(diary.createTicket(screening.id, screening.title, null, at));
      watchFor(diary, "viewer", screening.id, 600, at);
    }
    const collection = diary.collection("viewer");
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
    const screening = diary.start("Together", startTime);
    diary.watching("viewer", "tab", screening.id, true, startTime);
    competing.exec("BEGIN IMMEDIATE");
    assert.throws(() => diary.watching("viewer", "tab", screening.id, true, startTime + 10_000));
    assert.equal(diary.progress("viewer").watchedSeconds, 0);
    competing.exec("COMMIT");
    diary.watching("viewer", "tab", screening.id, true, startTime + 20_000);
    assert.equal(diary.progress("viewer").watchedSeconds, 20);
  } finally {
    competing.close();
    diary.close();
  }
});

test("watching without a design saves progress and late creation awards every eligible viewer once", () => {
  const diary = new CinemaDiary(":memory:");
  try {
    const screening = diary.start("Livestream", startTime);
    assert.equal(screening.ticketDesign, null);
    watchFor(diary, "first", screening.id, 600);
    watchFor(diary, "second", screening.id, 600);
    watchFor(diary, "almost", screening.id, 590);
    assert.equal(diary.progress("first").watchedSeconds, 600);
    assert.equal(diary.progress("first").ticket, null);
    assert.equal(diary.collection("first").total, 0);
    diary.watching("first", "first", screening.id, false, startTime + 610_000);
    const designed = diary.createTicket(
      screening.id,
      "The burrow's premiere",
      null,
      startTime + 620_000,
    );
    assert.ok(designed);
    assert.deepEqual(designed.ticketDesign, {
      title: "The burrow's premiere",
      imagePath: null,
      createdAt: new Date(startTime + 620_000).toISOString(),
    });
    for (const member of ["first", "second"]) {
      assert.equal(diary.progress(member).ticket?.title, "The burrow's premiere");
      assert.equal(diary.collection(member).total, 1);
    }
    assert.equal(diary.progress("almost").ticket, null);
    assert.equal(diary.createTicket(screening.id, "Replacement", null), null);
    assert.equal(diary.collection("first").total, 1);
    diary.watching("almost", "almost", screening.id, true, startTime + 600_000);
    assert.equal(diary.progress("almost").ticket?.number, 1);
    const next = diary.start("Next livestream", startTime + 700_000);
    assert.equal(next.ticketDesign, null);
    assert.equal(diary.createTicket(screening.id, "Old draft", null), null);
    assert.equal(diary.current()?.ticketDesign, null);
  } finally {
    diary.close();
  }
});

test("design images and immutable earned artwork survive restart and screening changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-cinema-image-"));
  const file = join(directory, "cinema.sqlite");
  const diary = new CinemaDiary(file);
  const screening = diary.start("Stream title", startTime);
  const image = { mimeType: "image/png", data: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]) };
  const designed = diary.createTicket(screening.id, "Collectible title", image, startTime);
  assert.ok(designed);
  watchFor(diary, "viewer", screening.id, 600);
  const ticket = diary.progress("viewer").ticket;
  assert.ok(ticket);
  assert.equal(ticket.title, "Collectible title");
  assert.equal(ticket.imagePath, `/api/cinema/screenings/${screening.id}/image`);
  diary.close();
  const restored = new CinemaDiary(file);
  try {
    assert.deepEqual(restored.current(), designed);
    assert.deepEqual(restored.image(screening.id), image);
    assert.equal(restored.createTicket(screening.id, "Changed title", null), null);
    restored.start("Next stream", startTime + 700_000);
    assert.deepEqual(restored.collection("viewer").tickets, [ticket]);
    assert.deepEqual(restored.image(screening.id), image);
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
    };
    assert.equal(diary.current()?.ticketDesign, null);
    assert.deepEqual(diary.collection("legacy-viewer").tickets, [expected]);
    diary.createTicket("legacy-screening", "New artwork title", null, startTime);
    assert.deepEqual(diary.collection("legacy-viewer").tickets, [expected]);
    const next = diary.start("New stream", startTime);
    diary.createTicket(next.id, "New ticket", null, startTime);
    watchFor(diary, "legacy-viewer", next.id, 600);
    assert.equal(diary.progress("legacy-viewer").ticket?.number, 8);
    assert.deepEqual(diary.collection("legacy-viewer").tickets[1], expected);
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
  { timeout: 5_000 },
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
        startTime + 3_600_000,
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
      const screening = diary.start("Together", now);
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
      now += 10_000;
      const second = nextCinemaMessage(socket);
      socket.send(JSON.stringify({ type: "watching", screeningId: screening.id, playing: true }));
      assert.equal(JSON.parse(await second).progress.watchedSeconds, 10);
      now += 10_000;
      const paused = nextCinemaMessage(socket);
      socket.send(JSON.stringify({ type: "watching", screeningId: screening.id, playing: false }));
      assert.equal(JSON.parse(await paused).progress.watchedSeconds, 10);
      const stale = nextCinemaMessage(socket);
      socket.send(
        JSON.stringify({ type: "watching", screeningId: "another-screening", playing: true }),
      );
      assert.equal(JSON.parse(await stale).progress.watchedSeconds, 10);
      assert.equal(diary.collection("viewer").total, 0);
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
