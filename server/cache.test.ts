import assert from "node:assert/strict";
import test from "node:test";

import { TtlCache } from "./cache";

test("TTL cache reuses live values and evicts the least recently used entry", async () => {
  const cache = new TtlCache(2);
  let loads = 0;
  const load = async () => ++loads;

  assert.equal(await cache.getOrLoad("a", 60, load), 1);
  assert.equal(await cache.getOrLoad("b", 60, load), 2);
  assert.equal(await cache.getOrLoad("a", 60, load), 1);
  assert.equal(await cache.getOrLoad("c", 60, load), 3);
  assert.equal(await cache.getOrLoad("b", 60, load), 4);
});

test("TTL cache coalesces concurrent misses", async () => {
  const cache = new TtlCache();
  let resolve!: (value: number) => void;
  let loads = 0;
  const pending = new Promise<number>((done) => {
    resolve = done;
  });
  const load = () => {
    loads += 1;
    return pending;
  };

  const first = cache.getOrLoad("a", 60, load);
  const second = cache.getOrLoad("a", 60, load);
  assert.equal(loads, 1);
  resolve(42);
  assert.deepEqual(await Promise.all([first, second]), [42, 42]);
});

test("TTL cache invalidation prevents stale loads from overwriting fresh values", async () => {
  const cache = new TtlCache();
  let resolveStale!: (value: string) => void;
  const stale = cache.getOrLoad(
    "movie:1",
    60,
    () =>
      new Promise<string>((done) => {
        resolveStale = done;
      }),
  );

  cache.invalidatePrefix("movie:");
  assert.equal(await cache.getOrLoad("movie:1", 60, async () => "fresh"), "fresh");
  resolveStale("stale");
  assert.equal(await stale, "stale");
  assert.equal(await cache.getOrLoad("movie:1", 60, async () => "wrong"), "fresh");
  assert.equal((cache as unknown as { generations: Map<string, number> }).generations.size, 0);
});
