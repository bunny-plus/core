import assert from "node:assert/strict";
import test from "node:test";

import { TtlCache } from "./cache";

test("TTL cache reuses live values and evicts the least recently used entry", async () => {
  const cache = new TtlCache(2);
  let loads = 0;
  const load = async () => ++loads;

  assert.equal(await cache.getOrLoad("a", 60, load), 1);
  assert.equal(await cache.getOrLoad("a", 60, load), 1);
  await cache.getOrLoad("b", 60, load);
  await cache.getOrLoad("c", 60, load);
  assert.equal(await cache.getOrLoad("a", 60, load), 4);
});
