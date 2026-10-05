import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { generateTicketBunny, isTicketBunny, maDongSeokBunny } from "../shared/ticket-bunny";
import { CinemaDiary } from "./cinema";

test("bunny generation is repeatable, varied, and produces supported parts", () => {
  assert.deepEqual(generateTicketBunny("screening-1"), generateTicketBunny("screening-1"));
  const designs = Array.from({ length: 100 }, (_, i) => generateTicketBunny(`screening-${i}`));
  assert.ok(designs.every(isTicketBunny));
  assert.ok(isTicketBunny(maDongSeokBunny));
  assert.ok(new Set(designs.map((design) => JSON.stringify(design))).size > 90);
});

test("bunny tickets retain their chosen parts across viewers, later screenings, and database restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ticket-bunny-"));
  const file = join(directory, "cinema.sqlite");
  let diary = new CinemaDiary(file);
  try {
    const original = diary.start("Original image-free ticket", 0);
    diary.createTicket(original.id, "Original ticket", null, 0);
    for (let time = 0; time <= 600_000; time += 10_000)
      diary.watching("viewer", "first-tab", original.id, true, time);
    const oldTicket = diary.collection("viewer").tickets[0];
    const screening = diary.start("Bunny screening", 700_000);
    const parts = generateTicketBunny("saved-bunny");
    const expected = { ...parts };
    // Someone who already reached ten minutes receives the design as soon as it is created.
    for (let time = 700_000; time <= 1_300_000; time += 10_000)
      diary.watching("viewer", "first-tab", screening.id, true, time);
    const created = diary.createTicket(screening.id, "Bunny night", null, 1_300_000, parts);
    assert.deepEqual(created?.ticketDesign?.bunny, expected);
    parts.fur = parts.fur === "cream" ? "ink" : "cream";
    assert.deepEqual(diary.current()?.ticketDesign?.bunny, expected);
    for (let time = 1_300_000; time <= 1_900_000; time += 10_000)
      diary.watching("second-viewer", "second-tab", screening.id, true, time);
    assert.deepEqual(diary.progress("second-viewer").ticket?.bunny, expected);
    assert.equal(diary.createTicket(screening.id, "Replacement", null, 1_900_000, parts), null);
    diary.close();
    diary = new CinemaDiary(file);
    assert.deepEqual(diary.current()?.ticketDesign?.bunny, expected);
    assert.deepEqual(diary.progress("viewer").ticket?.bunny, expected);
    const next = diary.start("Later screening", 2_000_000);
    diary.createTicket(next.id, "Different bunny", null, 2_000_000, generateTicketBunny("next"));
    const collection = diary.collection("viewer");
    assert.equal(collection.total, 2);
    assert.deepEqual(collection.tickets[0].bunny, expected);
    assert.equal(collection.tickets[0].imagePath, null);
    assert.equal(diary.image(screening.id), null);
    assert.deepEqual(collection.tickets[1], oldTicket);
  } finally {
    diary.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy conversion covers image, blank, and early tickets once while preserving ownership and artwork bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ticket-bunny-upgrade-"));
  const file = join(directory, "cinema.sqlite");
  let diary = new CinemaDiary(file);
  const image = { mimeType: "image/png", data: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]) };
  try {
    const blank = diary.start("Original stream title", 0);
    diary.createTicket(blank.id, "Original blank ticket", null, 0);
    for (let time = 0; time <= 600_000; time += 10_000)
      for (const viewer of ["owner", "friend"])
        diary.watching(viewer, viewer, blank.id, true, time);
    const chosen = diary.start("Existing bunny", 700_000);
    diary.createTicket(chosen.id, "Chosen bunny", null, 700_000, maDongSeokBunny);
    for (let time = 700_000; time <= 1_300_000; time += 10_000)
      diary.watching("owner", "owner", chosen.id, true, time);
    const illustrated = diary.start("Image screening", 1_400_000);
    diary.createTicket(illustrated.id, "Original image ticket", image, 1_400_000);
    for (let time = 1_400_000; time <= 2_000_000; time += 10_000)
      diary.watching("owner", "owner", illustrated.id, true, time);
    diary.watching("almost", "almost", illustrated.id, true, 1_400_000);
    diary.watching("almost", "almost", illustrated.id, true, 1_410_000);
    const before = diary.collection("owner");
    diary.close();
    const previousVersion = new DatabaseSync(file);
    // Model a database from before this upgrade; it may already have hand-picked bunnies.
    previousVersion.exec(
      "DROP TABLE cinema_ticket_migrations; DROP TABLE cinema_legacy_ticket_bunnies;",
    );
    previousVersion
      .prepare(
        "INSERT INTO cinema_tickets (id, member_id, screening_id, earned_at, number) VALUES (?, ?, ?, ?, ?)",
      )
      .run("early-ticket", "early-viewer", blank.id, "2026-09-29T17:10:00.000Z", 42);
    previousVersion.close();

    diary = new CinemaDiary(file);
    const converted = diary.collection("owner");
    assert.equal(converted.total, before.total);
    for (const [index, ticket] of converted.tickets.entries()) {
      assert.ok(ticket.bunny);
      assert.deepEqual(ticket, { ...before.tickets[index], bunny: ticket.bunny });
    }
    assert.deepEqual(converted.tickets[1], before.tickets[1]);
    assert.deepEqual(diary.image(illustrated.id), image);
    assert.deepEqual(diary.current()?.ticketDesign?.bunny, converted.tickets[0].bunny);
    assert.deepEqual(diary.progress("owner").ticket?.bunny, converted.tickets[0].bunny);
    assert.equal(diary.progress("almost").watchedSeconds, 10);
    assert.equal(diary.progress("almost").ticket, null);
    assert.equal(diary.collection("stranger").total, 0);
    assert.equal(diary.collection("friend").total, 1);
    assert.deepEqual(diary.collection("friend").tickets[0].bunny, converted.tickets[2].bunny);
    const early = diary.collection("early-viewer").tickets[0];
    assert.equal(early.id, "early-ticket");
    assert.equal(early.title, "Original stream title");
    assert.equal(early.number, 42);
    assert.equal(early.earnedAt, "2026-09-29T17:10:00.000Z");
    assert.deepEqual(early.bunny, converted.tickets[2].bunny);

    const next = diary.start("Intentionally no artwork", 2_100_000);
    diary.createTicket(next.id, "Plain ticket", null, 2_100_000);
    for (let time = 2_100_000; time <= 2_700_000; time += 10_000)
      diary.watching("owner", "owner", next.id, true, time);
    const after = diary.collection("owner");
    assert.equal(after.tickets[0].bunny, undefined);
    diary.close();
    diary = new CinemaDiary(file);
    assert.deepEqual(diary.collection("owner"), after);
    assert.deepEqual(diary.collection("early-viewer").tickets[0], early);
    assert.equal(diary.current()?.ticketDesign?.bunny, undefined);
    assert.deepEqual(diary.image(illustrated.id), image);
  } finally {
    diary.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an interrupted legacy conversion rolls back its artwork and completion marker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ticket-bunny-rollback-"));
  const file = join(directory, "cinema.sqlite");
  const diary = new CinemaDiary(file);
  const screening = diary.start("Old screening", 0);
  diary.createTicket(screening.id, "Old design", null, 0);
  diary.close();
  const previousVersion = new DatabaseSync(file);
  try {
    previousVersion.exec("DELETE FROM cinema_ticket_migrations");
    previousVersion
      .prepare(
        "INSERT INTO cinema_tickets (id, member_id, screening_id, earned_at, number) VALUES (?, ?, ?, ?, ?)",
      )
      .run("old-ticket", "owner", screening.id, "2026-09-29T17:10:00.000Z", 1);
    previousVersion.exec(
      "CREATE TRIGGER fail_bunny_upgrade BEFORE INSERT ON cinema_legacy_ticket_bunnies BEGIN SELECT RAISE(ABORT, 'upgrade interrupted'); END;",
    );
    assert.throws(() => new CinemaDiary(file), /upgrade interrupted/);
    assert.equal(
      previousVersion.prepare("SELECT COUNT(*) AS total FROM cinema_ticket_bunnies").get()?.total,
      0,
    );
    assert.equal(
      previousVersion.prepare("SELECT COUNT(*) AS total FROM cinema_ticket_migrations").get()
        ?.total,
      0,
    );
    assert.equal(
      previousVersion.prepare("SELECT COUNT(*) AS total FROM cinema_tickets").get()?.total,
      1,
    );
    previousVersion.exec("DROP TRIGGER fail_bunny_upgrade");
    const recovered = new CinemaDiary(file);
    try {
      assert.ok(recovered.collection("owner").tickets[0].bunny);
      assert.equal(recovered.collection("owner").tickets[0].title, "Old screening");
    } finally {
      recovered.close();
    }
  } finally {
    previousVersion.close();
    await rm(directory, { recursive: true, force: true });
  }
});
