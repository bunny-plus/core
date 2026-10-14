import assert from "node:assert/strict";
import test from "node:test";
import { SerialQueue } from "./serial-queue";

test("queued operations wait their turn and continue after a rejected operation", async () => {
  const queue = new SerialQueue();
  const events: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const failed = queue.run(async () => {
    events.push("first started");
    await held;
    events.push("first failed");
    throw new Error("upstream failed");
  });
  const rejection = assert.rejects(failed, /upstream failed/);
  const second = queue.run(async () => {
    events.push("second finished");
    return 42;
  });
  const third = queue.run(async () => {
    events.push("third finished");
  });
  await Promise.resolve();
  assert.deepEqual(events, ["first started"]);
  release();
  await rejection;
  assert.equal(await second, 42);
  await third;
  assert.deepEqual(events, ["first started", "first failed", "second finished", "third finished"]);
});
