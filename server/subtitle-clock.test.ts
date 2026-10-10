import assert from "node:assert/strict";
import test from "node:test";
import { SubtitleClock, subtitleTime } from "../src/subtitle-clock";

function buffered(...ranges: [number, number][]): TimeRanges {
  return {
    length: ranges.length,
    start: (index) => ranges[index][0],
    end: (index) => ranges[index][1],
  };
}

function fragment(sn: number, start: number, programDateTime: number | null, cc = 0) {
  return { sn, start, end: start + 4, programDateTime, cc, level: 0 };
}

test("buffer recovery uses the presented frame's segment across timing discontinuities", () => {
  const clock = new SubtitleClock();
  const start = 1_800_000_000_000;
  const fragments = [fragment(1, 10, start + 10_000), fragment(2, 14, start + 26_000, 1)];
  const ranges = buffered([10, 18]);
  const time = (mediaTime: number) =>
    subtitleTime(clock.programDate(mediaTime, fragments, ranges), start, 0);

  assert.equal(time(13.5), 13.5);
  // Buffering freezes on the displayed frame even when the live playlist advances.
  assert.equal(time(13.5), 13.5);
  // The audio clock or HLS's active fragment may still describe the previous segment.
  // A catch-up seek must immediately use the newly presented segment's own date.
  assert.equal(time(14), 26);
  assert.equal(time(15.5), 27.5);
  assert.equal(time(13.5), 13.5);
});

test("slow playback retains buffered segment timing after the live playlist slides", () => {
  const clock = new SubtitleClock();
  const start = 1_800_000_000_000;
  const old = [fragment(1, 10, start + 10_000), fragment(2, 14, start + 14_000)];
  const live = [fragment(8, 38, start + 38_000), fragment(9, 42, start + 42_000)];

  assert.equal(clock.programDate(11, old, buffered([10, 18])), start + 11_000);
  assert.equal(clock.programDate(11, live, buffered([10, 18], [38, 46])), start + 11_000);
  assert.equal(clock.programDate(15, live, buffered([10, 18], [38, 46])), start + 15_000);
  assert.equal(clock.programDate(43, live, buffered([10, 18], [38, 46])), start + 43_000);
  // Once the browser evicts a segment, its old timing must not be reused.
  assert.equal(clock.programDate(15, live, buffered([38, 46])), null);
});

test("missing segment dates and buffer gaps never extrapolate stale subtitle timing", () => {
  const clock = new SubtitleClock();
  const start = 1_800_000_000_000;
  const fragments = [fragment(1, 10, start + 10_000), fragment(2, 14, null), fragment(3, 22, NaN)];
  const ranges = buffered([10, 18], [22, 26]);

  assert.equal(clock.programDate(13.5, fragments, ranges), start + 13_500);
  for (const position of [14, 15, 19, 22, 26, NaN, Infinity])
    assert.equal(clock.programDate(position, fragments, ranges), null);
  assert.equal(clock.programDate(13.5, fragments, buffered()), null);
});

test("reconnecting with a new media timeline does not reuse the previous stream's dates", () => {
  const start = 1_800_000_000_000;
  const oldClock = new SubtitleClock();
  assert.equal(
    oldClock.programDate(11, [fragment(1, 10, start + 10_000)], buffered([10, 14])),
    start + 11_000,
  );
  const clock = new SubtitleClock();
  assert.equal(clock.programDate(11, [], buffered([10, 14])), null);
  const newFragments = [fragment(1, 0, start + 60_000)];
  assert.equal(clock.programDate(1, newFragments, buffered([0, 4])), start + 61_000);
  assert.equal(
    subtitleTime(clock.programDate(1, newFragments, buffered([0, 4])), start, 1.5),
    59.5,
  );
});

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
