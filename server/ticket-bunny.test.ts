import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  bowBunny,
  bunnyAccessories,
  generateTicketBunny,
  isTicketBunny,
  maDongSeokBunny,
} from "../shared/ticket-bunny";
import { CinemaDiary } from "./cinema";

test("all accessory choices survive ticket storage alongside the original designs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ticket-accessories-"));
  const file = join(directory, "cinema.sqlite");
  let diary = new CinemaDiary(file);
  try {
    assert.equal(bunnyAccessories.length, 60);
    assert.equal(new Set(bunnyAccessories).size, 60);
    assert.deepEqual(bunnyAccessories.slice(0, 9), [
      "bow",
      "leopardbow",
      "flower",
      "tiara",
      "headphones",
      "heartshades",
      "hoops",
      "flipphone",
      "chain",
    ]);
    for (const [index, accessory] of bunnyAccessories.entries()) {
      const at = index * 700000;
      const parts = { ...bowBunny, accessory };
      assert.ok(isTicketBunny(parts));
      const screening = await diary.start(accessory, at);
      assert.deepEqual(
        (await diary.createTicket(screening.id, accessory, null, at, parts))?.ticketDesign?.bunny,
        parts,
      );
      for (let elapsed = 0; elapsed <= 600000; elapsed += 10000)
        await diary.watching("owner", "tab", screening.id, true, at + elapsed);
    }
    const expected = await diary.collection("owner");
    assert.equal(expected.total, bunnyAccessories.length);
    for (const ticket of expected.tickets)
      assert.deepEqual(ticket.bunny, { ...bowBunny, accessory: ticket.title });
    diary.close();
    diary = new CinemaDiary(file);
    assert.deepEqual(await diary.collection("owner"), expected);
  } finally {
    diary.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("bunny generation is repeatable, varied, and produces supported parts", () => {
  assert.deepEqual(generateTicketBunny("screening-1"), generateTicketBunny("screening-1"));
  const designs = Array.from({ length: 100 }, (_, i) => generateTicketBunny(`screening-${i}`));
  assert.ok(designs.every(isTicketBunny));
  assert.ok(isTicketBunny(maDongSeokBunny));
  assert.ok(isTicketBunny(bowBunny));
  assert.ok(new Set(designs.map((design) => JSON.stringify(design))).size > 90);
});

test("bunny tickets retain their chosen parts across viewers, later screenings, and database restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ticket-bunny-"));
  const file = join(directory, "cinema.sqlite");
  let diary = new CinemaDiary(file);
  try {
    const original = await diary.start("Original image-free ticket", 0);
    await diary.createTicket(original.id, "Original ticket", null, 0);
    for (let time = 0; time <= 600000; time += 10000)
      await diary.watching("viewer", "first-tab", original.id, true, time);
    const oldTicket = (await diary.collection("viewer")).tickets[0];
    const screening = await diary.start("Bunny screening", 700000);
    const parts = { ...bowBunny };
    const expected = { ...parts };
    // Someone who already reached ten minutes receives the design as soon as it is created.
    for (let time = 700000; time <= 1300000; time += 10000)
      await diary.watching("viewer", "first-tab", screening.id, true, time);
    const created = await diary.createTicket(screening.id, "Bunny night", null, 1300000, parts);
    assert.deepEqual(created?.ticketDesign?.bunny, expected);
    parts.fur = parts.fur === "cream" ? "ink" : "cream";
    assert.deepEqual((await diary.current())?.ticketDesign?.bunny, expected);
    for (let time = 1300000; time <= 1900000; time += 10000)
      await diary.watching("second-viewer", "second-tab", screening.id, true, time);
    assert.deepEqual((await diary.progress("second-viewer")).ticket?.bunny, expected);
    assert.equal(await diary.createTicket(screening.id, "Replacement", null, 1900000, parts), null);
    diary.close();
    diary = new CinemaDiary(file);
    assert.deepEqual((await diary.current())?.ticketDesign?.bunny, expected);
    assert.deepEqual((await diary.progress("viewer")).ticket?.bunny, expected);
    const next = await diary.start("Later screening", 2000000);
    await diary.createTicket(
      next.id,
      "Different bunny",
      null,
      2000000,
      generateTicketBunny("next"),
    );
    const collection = await diary.collection("viewer");
    assert.equal(collection.total, 2);
    assert.deepEqual(collection.tickets[0].bunny, expected);
    assert.equal(collection.tickets[0].imagePath, null);
    assert.equal(await diary.image(screening.id), null);
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
    const blank = await diary.start("Original stream title", 0);
    await diary.createTicket(blank.id, "Original blank ticket", null, 0);
    for (let time = 0; time <= 600000; time += 10000)
      for (const viewer of ["owner", "friend"])
        await diary.watching(viewer, viewer, blank.id, true, time);
    const chosen = await diary.start("Existing bunny", 700000);
    await diary.createTicket(chosen.id, "Chosen bunny", null, 700000, maDongSeokBunny);
    for (let time = 700000; time <= 1300000; time += 10000)
      await diary.watching("owner", "owner", chosen.id, true, time);
    const illustrated = await diary.start("Image screening", 1400000);
    await diary.createTicket(illustrated.id, "Original image ticket", image, 1400000);
    for (let time = 1400000; time <= 2000000; time += 10000)
      await diary.watching("owner", "owner", illustrated.id, true, time);
    await diary.watching("almost", "almost", illustrated.id, true, 1400000);
    await diary.watching("almost", "almost", illustrated.id, true, 1410000);
    const before = await diary.collection("owner");
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
    const converted = await diary.collection("owner");
    assert.equal(converted.total, before.total);
    for (const [index, ticket] of converted.tickets.entries()) {
      assert.ok(ticket.bunny);
      assert.deepEqual(ticket, { ...before.tickets[index], bunny: ticket.bunny });
    }
    assert.deepEqual(converted.tickets[1], before.tickets[1]);
    assert.deepEqual(await diary.image(illustrated.id), image);
    assert.deepEqual((await diary.current())?.ticketDesign?.bunny, converted.tickets[0].bunny);
    assert.deepEqual((await diary.progress("owner")).ticket?.bunny, converted.tickets[0].bunny);
    assert.equal((await diary.progress("almost")).watchedSeconds, 10);
    assert.equal((await diary.progress("almost")).ticket, null);
    assert.equal((await diary.collection("stranger")).total, 0);
    assert.equal((await diary.collection("friend")).total, 1);
    assert.deepEqual(
      (await diary.collection("friend")).tickets[0].bunny,
      converted.tickets[2].bunny,
    );
    const early = (await diary.collection("early-viewer")).tickets[0];
    assert.equal(early.id, "early-ticket");
    assert.equal(early.title, "Original stream title");
    assert.equal(early.number, 42);
    assert.equal(early.earnedAt, "2026-09-29T17:10:00.000Z");
    assert.deepEqual(early.bunny, converted.tickets[2].bunny);
    const next = await diary.start("Intentionally no artwork", 2100000);
    await diary.createTicket(next.id, "Plain ticket", null, 2100000);
    for (let time = 2100000; time <= 2700000; time += 10000)
      await diary.watching("owner", "owner", next.id, true, time);
    const after = await diary.collection("owner");
    assert.equal(after.tickets[0].bunny, undefined);
    diary.close();
    diary = new CinemaDiary(file);
    assert.deepEqual(await diary.collection("owner"), after);
    assert.deepEqual((await diary.collection("early-viewer")).tickets[0], early);
    assert.equal((await diary.current())?.ticketDesign?.bunny, undefined);
    assert.deepEqual(await diary.image(illustrated.id), image);
  } finally {
    diary.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an interrupted legacy conversion rolls back its artwork and completion marker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ticket-bunny-rollback-"));
  const file = join(directory, "cinema.sqlite");
  const diary = new CinemaDiary(file);
  const screening = await diary.start("Old screening", 0);
  await diary.createTicket(screening.id, "Old design", null, 0);
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
    await assert.rejects(new CinemaDiary(file).ready, /upgrade interrupted/);
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
      assert.ok((await recovered.collection("owner")).tickets[0].bunny);
      assert.equal((await recovered.collection("owner")).tickets[0].title, "Old screening");
    } finally {
      recovered.close();
    }
  } finally {
    previousVersion.close();
    await rm(directory, { recursive: true, force: true });
  }
});
