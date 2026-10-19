import assert from "node:assert/strict";
import { test } from "node:test";
import { videoMetrics } from "../src/webrtc-stats";

const before = {
  id: "video",
  timestamp: 1000,
  framesDecoded: 240,
  bytesReceived: 100_000,
  jitterBufferDelay: 4,
  jitterBufferTargetDelay: 6,
  jitterBufferEmittedCount: 240,
};
const after = {
  ...before,
  timestamp: 3000,
  framesDecoded: 288,
  bytesReceived: 600_000,
  jitterBufferDelay: 4.96,
  jitterBufferTargetDelay: 7.44,
  jitterBufferEmittedCount: 288,
  jitter: 0.002,
  packetsLost: 2,
  freezeCount: 1,
  framesDropped: 3,
};

test("WebRTC stats measure recent frame rate, bitrate and receiver delay", () => {
  const result = videoMetrics(after, before);
  assert.equal(result.fps, 24);
  assert.equal(result.bitrate, 2_000_000);
  assert.ok(Math.abs(result.buffer! - 20) < 0.001);
  assert.ok(Math.abs(result.targetBuffer! - 30) < 0.001);
  assert.equal(result.jitter, 2);
  assert.equal(result.packetsLost, 2);
  assert.equal(result.freezes, 1);
  assert.equal(result.droppedFrames, 3);
});

test("unavailable stats and new sessions do not invent rates or buffer measurements", () => {
  for (const previous of [undefined, { ...before, id: "other" }, { ...before, timestamp: 3000 }]) {
    const result = videoMetrics(after, previous);
    assert.equal(result.fps, null);
    assert.equal(result.bitrate, null);
    assert.equal(result.buffer, null);
  }
  const unsupported = videoMetrics({ id: "video", timestamp: 4000 });
  assert.equal(unsupported.jitter, null);
  assert.equal(unsupported.freezes, null);
  assert.equal(unsupported.packetsLost, null);
});

test("counter resets and an empty receiver buffer do not produce negative or infinite stats", () => {
  const result = videoMetrics({ ...before, timestamp: 5000 }, after);
  assert.equal(result.fps, null);
  assert.equal(result.bitrate, null);
  assert.equal(result.buffer, null);
  const stalled = videoMetrics({ ...before, timestamp: 2000 }, before);
  assert.equal(stalled.fps, 0);
  assert.equal(stalled.buffer, null);
});
