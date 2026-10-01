import assert from "node:assert/strict";
import test from "node:test";
import { subtitleTime } from "../src/subtitle-clock";

test("subtitles follow the presented program date for late joins, buffers and reconnects", () => {
  const start = 1_800_000_000_000;
  assert.equal(subtitleTime(start + 1_800_000, start, 0), 1_800);
  // A stalled frame keeps the same time, regardless of how much wall time passes.
  assert.equal(subtitleTime(start + 1_800_000, start, 0), 1_800);
  // Seeking forward or recreating HLS with a new media-time origin follows program date.
  assert.equal(subtitleTime(start + 1_813_000, start, 0), 1_813);
  assert.equal(subtitleTime(start + 1_813_000, start, 1.5), 1_811.5);
  assert.equal(subtitleTime(start + 1_813_000, start, -0.5), 1_813.5);
});

test("subtitles wait for clock metadata and reject the previous relay's buffered frames", () => {
  assert.equal(subtitleTime(null, 1_800_000_000_000, 0), null);
  assert.equal(subtitleTime(1_800_000_000_000, null, 0), null);
  assert.equal(subtitleTime(Number.NaN, 1_800_000_000_000, 0), null);
  assert.ok(subtitleTime(1_800_000_000_000, 1_800_000_010_000, 0)! < 0);
});
