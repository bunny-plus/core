import assert from "node:assert/strict";
import test from "node:test";

import { playbackConfig, PlaybackSynchronizer } from "../src/playback";

function buffered(...ranges: [number, number][]): TimeRanges {
  return {
    length: ranges.length,
    start: (index) => ranges[index][0],
    end: (index) => ranges[index][1],
  };
}

function media() {
  return {
    currentTime: 20,
    buffered: buffered([10, 40]),
    readyState: 4,
    seeking: false,
    paused: false,
  };
}

test("segment jitter and short drift spikes do not trigger seeks or speed changes", () => {
  const sync = new PlaybackSynchronizer();
  const video = media();
  for (let second = 0; second < 120; second++) {
    const correction = sync.update(
      video,
      video.currentTime + [3, -3, 6, 6][second % 4],
      second * 1000,
    );
    assert.equal(correction.position, null);
    assert.equal(correction.rate, 1);
  }
});

test("sustained drift corrects once and repeated corrections have a cooldown", () => {
  const sync = new PlaybackSynchronizer();
  const video = media();
  const seeks: number[] = [];
  for (let second = 0; second < 35; second++) {
    if (sync.update(video, 27, second * 1000).position !== null) seeks.push(second);
  }
  assert.deepEqual(seeks, [3, 18, 33]);
});

test("resynchronization waits for downloaded media, avoiding gaps and the buffer edge", () => {
  for (const ranges of [
    buffered([10, 25], [29, 40]),
    buffered([10, 28]),
    buffered([10, 20.5], [26, 40]),
  ]) {
    const sync = new PlaybackSynchronizer();
    const video = { ...media(), buffered: ranges };
    for (let second = 0; second < 30; second++)
      assert.equal(sync.update(video, 27, second * 1000).position, null);
    video.buffered = buffered([10, 40]);
    assert.equal(sync.update(video, 27, 30_000).position, 27);
  }
});

test("buffering, pausing and seeking reset the drift observation period", () => {
  for (const state of [{ readyState: 2 }, { paused: true }, { seeking: true }]) {
    const sync = new PlaybackSynchronizer();
    const video = media();
    sync.update(video, 27, 0);
    assert.equal(sync.update({ ...video, ...state }, 27, 3000).position, null);
    assert.equal(sync.update(video, 27, 4000).position, null);
    assert.equal(sync.update(video, 27, 7000).position, 27);
  }
});

test("missing timelines and changing drift direction cannot cause an immediate seek", () => {
  const sync = new PlaybackSynchronizer();
  const video = media();
  for (const target of [null, NaN, Infinity])
    assert.equal(sync.update(video, target, 0).position, null);
  sync.update(video, 27, 1000);
  assert.equal(sync.update(video, 13, 4000).position, null);
  assert.equal(sync.update(video, 13, 7000).position, 13);
});

test("two simulated hours recover from intermittent stalls without a seek loop", () => {
  const sync = new PlaybackSynchronizer();
  const video = media();
  let seeks = 0;
  let lastSeek = -Infinity;
  for (let second = 0; second < 7200; second++) {
    const stalled = second >= 900 && second % 900 < 8;
    video.readyState = stalled ? 2 : 4;
    if (!stalled) video.currentTime += 1;
    const target = second + 21;
    video.buffered = buffered([Math.max(0, video.currentTime - 10), target + 6]);
    const correction = sync.update(video, target, second * 1000);
    assert.equal(correction.rate, 1);
    if (correction.position !== null) {
      assert.ok(second - lastSeek >= 15);
      lastSeek = second;
      video.currentTime = correction.position;
      seeks++;
    }
  }
  assert.equal(seeks, 7);
  assert.equal(video.currentTime, 7220);
});

test("slow connection lets playback fall behind without seeking or speeding up", () => {
  const sync = new PlaybackSynchronizer();
  const video = media();
  sync.update(video, 27, 0);
  for (let second = 1; second < 7200; second++) {
    video.readyState = second % 8 === 0 ? 2 : 4;
    const correction = sync.update(video, 27 + second, second * 1000, false);
    assert.equal(correction.position, null);
    assert.equal(correction.rate, 1);
    assert.match(correction.label, /sync off/);
  }
  video.readyState = 4;
  // Re-enabling sync observes fresh drift before correcting.
  assert.equal(sync.update(video, 27, 7_200_000).position, null);
  assert.equal(sync.update(video, 27, 7_203_000).position, 27);
});

test("slow connection disables HLS latency seeking and keeps buffer memory bounded", () => {
  const config = playbackConfig(6, false);
  Object.assign(config, playbackConfig(6, true));
  assert.equal(config.liveMaxLatencyDuration, Infinity);
  assert.equal(config.maxLiveSyncPlaybackRate, 1);
  assert.equal(config.lowLatencyMode, false);
  assert.ok(config.liveSyncDuration >= 18);
  assert.ok(config.maxBufferLength > playbackConfig(6, false).maxBufferLength);
  assert.ok(config.maxBufferLength <= config.maxMaxBufferLength);
  assert.ok(config.maxMaxBufferLength <= 30);
  assert.equal(config.backBufferLength, 10);
  assert.equal(playbackConfig(60, true).liveSyncDuration, 60);
  Object.assign(config, playbackConfig(6, false));
  assert.deepEqual(config, playbackConfig(6, false));
});
